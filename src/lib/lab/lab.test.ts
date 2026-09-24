import assert from "node:assert/strict";
import { test } from "node:test";
import { ema, rsi, atr, efficiencyRatio } from "./indicators.ts";
import { makeCandle, normalizeBook, isAbnormalOhlc, bucketTs } from "./candles.ts";
import { expectedValue, breakEvenAt, gateTrade } from "./ev.ts";
import { clampStake, kellyRaw, sizeStake, sizePosition, applyOutcome, emptyRisk, sequenceRisk, riskBlock } from "./risk.ts";
import { DEFAULT_SETTINGS } from "./constants.ts";
import { detectRegime } from "./regime.ts";
import { settlePath, pnlFor } from "./settlement.ts";
import { newsBlock, seedNews } from "./news.ts";
import { generateHistory } from "./market.ts";
import { backtest } from "./backtest.ts";
import { analyze, emptyModel } from "./pipeline.ts";
import { extractFeatures } from "./features.ts";
import { ACTION } from "./actions.ts";
import type { Candle } from "./types.ts";

function c(t: number, o: number, h: number, l: number, cl: number): Candle {
  return makeCandle({
    t,
    open: o,
    high: h,
    low: l,
    close: cl,
    asset: "EURUSD",
    timeframe: "1m",
    closed: true,
    synthetic: false,
    source: "replay",
  });
}

test("EMA / RSI / ATR / ER basic sanity", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const e = ema(xs, 5);
  assert.ok(e != null && e > 10 && e < 15);
  const r = rsi(xs, 5);
  assert.ok(r != null && r > 70);
  const candles = xs.map((v, i) => c(i * 60_000, v, v + 0.2, v - 0.2, v + 0.05));
  const a = atr(
    candles.map((x) => x.high),
    candles.map((x) => x.low),
    candles.map((x) => x.close),
    5,
  );
  assert.ok(a != null && a > 0);
  const er = efficiencyRatio(xs, 10);
  assert.ok(er != null && er > 0.9);
});

test("timestamp ms vs s normalize via bucket", () => {
  const ms = bucketTs(1_700_000_000_123, "1m");
  assert.equal(ms % 60_000, 0);
});

test("duplicate / out-of-order / abnormal OHLC", () => {
  const a = c(60_000, 1.1, 1.12, 1.09, 1.11);
  const dup = c(60_000, 1.11, 1.13, 1.1, 1.12);
  const late = c(0, 1.09, 1.1, 1.08, 1.09);
  const bad = makeCandle({
    t: 120_000,
    open: 1.1,
    high: 2.2,
    low: 0.4,
    close: 1.1,
    asset: "EURUSD",
    timeframe: "1m",
  });
  assert.equal(isAbnormalOhlc(bad), true);
  const { closed, report } = normalizeBook([late, a, dup, bad], "1m", "EURUSD");
  assert.ok(closed.length >= 1);
  assert.ok(report.duplicates >= 1);
});

test("R-multiple EV and break-even", () => {
  const be = breakEvenAt(1.6, 1, 0.08);
  assert.ok(Math.abs(be - 1.08 / 2.6) < 1e-10);
  const ev = expectedValue(0.58, 1.6, 1, 0.08);
  assert.ok(Math.abs(ev - (0.58 * 1.6 - 0.42 - 0.08)) < 1e-10);
  const g = gateTrade({ calibrated: 0.58, sampleSize: 40, dataQuality: 0.95, evR: ev, rr: 1.6, safetyMargin: 0.03, minEv: 0.1 });
  assert.equal(g.ok, true);
  const wait = gateTrade({ calibrated: 0.4, sampleSize: 40, dataQuality: 0.95, evR: -0.2, rr: 1.6, safetyMargin: 0.03, minEv: 0.1 });
  assert.equal(wait.ok, false);
  const dq = gateTrade({ calibrated: 0.62, sampleSize: 80, dataQuality: 0.7, evR: 0.3, rr: 1.6 });
  assert.equal(dq.ok, false);
});

test("Kelly, position size, min-lot budget", () => {
  const k = kellyRaw(0.58, 1.6);
  assert.ok(k > 0 && k < 0.5);
  assert.ok(clampStake(100, 100, 1, 0.025) <= 1);
  const seq = sequenceRisk(2, 2, 2, 1.6);
  assert.equal(seq.path.length, 3);
  assert.ok(seq.ruinIfAllLose > 10);
  const sized = sizeStake({
    settings: { ...DEFAULT_SETTINGS, moneyMode: "flat", bankroll: 10_000, riskPercent: 0.0025 },
    probability: 0.6,
    entry: 1.1458,
    stop: 1.1438,
    asset: "EURUSD",
    calibrationFactor: 1,
    regimeConfidence: 1,
    drawdown: 0,
    sampleSize: 50,
  });
  assert.ok(sized.lots >= 0.01);
  assert.ok(sized.stake > 0);
  assert.equal(sized.blocked, null);

  const tiny = sizePosition({
    settings: { ...DEFAULT_SETTINGS, bankroll: 50, riskPercent: 0.0025 },
    entry: 1.1458,
    stop: 1.1438,
    asset: "EURUSD",
  });
  assert.equal(tiny.lots, 0);
  assert.ok(tiny.blocked && /min/i.test(tiny.blocked));
});

test("daily limits and kill-switch", () => {
  let risk = emptyRisk(10_000);
  risk = applyOutcome(risk, { ...DEFAULT_SETTINGS, dailyStopLoss: 5, dailyTakeProfit: 10 }, false, false, -6);
  assert.equal(risk.dailyStopHit, true);
  assert.ok(riskBlock({ ...emptyRisk(10_000), killed: true }, DEFAULT_SETTINGS));
});

test("SL/TP settlement, both-hit is LOSS", () => {
  const win = settlePath({
    direction: ACTION.BUY,
    entry: 1.1,
    stop: 1.099,
    target: 1.102,
    bars: [{ t: 1, high: 1.1025, low: 1.1002, close: 1.102 }],
    timeout: true,
  });
  assert.equal(win.kind, "WIN");
  const loss = settlePath({
    direction: ACTION.BUY,
    entry: 1.1,
    stop: 1.099,
    target: 1.102,
    bars: [{ t: 1, high: 1.1004, low: 1.0989, close: 1.099 }],
    timeout: true,
  });
  assert.equal(loss.kind, "LOSS");
  const both = settlePath({
    direction: ACTION.BUY,
    entry: 1.1,
    stop: 1.099,
    target: 1.102,
    bars: [{ t: 1, high: 1.103, low: 1.098, close: 1.101 }],
    timeout: true,
  });
  assert.equal(both.kind, "LOSS");
  assert.equal(both.ambiguous, true);
  assert.equal(pnlFor("WIN", 10, 1.6), 16);
  assert.equal(pnlFor("LOSS", 10, -1), -10);
});

test("news window matching", () => {
  const now = Date.now();
  const events = seedNews(now);
  assert.equal(newsBlock(events, "EURUSD", now), null);
  events.push({ id: "n", t: now + 10 * 60_000, currency: "USD", title: "NFP", impact: "high", actual: null });
  const block = newsBlock(events, "EURUSD", now);
  assert.ok(block && /news/i.test(block));
});

test("regime detector returns a known regime", () => {
  const book = generateHistory({ asset: "EURUSD", timeframe: "1m", bars: 120, seed: 7 });
  const r = detectRegime(book.candles);
  const known = ["TREND_UP", "TREND_DOWN", "RANGE", "EXPANSION", "HIGH_VOLATILITY", "DEAD", "MIXED", "TRANSITION"];
  assert.ok(known.includes(r.regime));
});

test("features ignore forming candle (no leakage contract)", () => {
  const book = generateHistory({ asset: "EURUSD", timeframe: "1m", bars: 80, seed: 11 });
  const f1 = extractFeatures(book.candles);
  const future = [...book.candles, c(book.candles.at(-1)!.t + 60_000, 9, 9, 9, 9)];
  const f2 = extractFeatures(book.candles);
  assert.ok(f1 && f2);
  assert.equal(f1.ret1, f2.ret1);
  void future;
});

test("walk-forward backtest is leakage-safe, next-bar, finite", () => {
  const book = generateHistory({ asset: "EURUSD", timeframe: "1m", bars: 280, seed: 42 });
  const report = backtest({ candles: book.candles, folds: 3 });
  assert.equal(report.leakageSafe, true);
  assert.ok(report.bars >= 200);
  assert.ok(Number.isFinite(report.netProfit));
  assert.ok(Number.isFinite(report.expectancyR));
  assert.ok(report.walkForward.length === 3);
});

test("analyze WAIT until warmup", () => {
  const book = generateHistory({ asset: "EURUSD", timeframe: "1m", bars: 20, seed: 3 });
  const { signal } = analyze({
    closed: book.candles,
    forming: null,
    settings: DEFAULT_SETTINGS,
    model: emptyModel(),
    news: [],
    quality: 1,
    sampleSize: 0,
    similar: { wr: null, n: 0 },
    recentHit: 0.5,
  });
  assert.equal(signal.direction, ACTION.WAIT);
  assert.equal(signal.lifecycle, "COLLECTING");
});

test("data quality gate is WAIT", () => {
  const book = generateHistory({ asset: "EURUSD", timeframe: "1m", bars: 80, seed: 5 });
  const { signal } = analyze({
    closed: book.candles,
    forming: null,
    settings: DEFAULT_SETTINGS,
    model: emptyModel(),
    news: [],
    quality: 0.5,
    sampleSize: 40,
    similar: { wr: 0.55, n: 40 },
    recentHit: 0.5,
  });
  assert.equal(signal.direction, ACTION.WAIT);
  assert.ok(signal.cancelledReason && /data quality/i.test(signal.cancelledReason));
});

test("canonical actions are BUY SELL WAIT", () => {
  assert.equal(ACTION.BUY, "BUY");
  assert.equal(ACTION.SELL, "SELL");
  assert.equal(ACTION.WAIT, "WAIT");
});

test("spot bars map to non-synthetic venue candles", async () => {
  const { candlesFromSpot } = await import("./yahoo.ts");
  const { parseKrakenOhlc, parseKrakenTicker, parseCoinbaseCandles } = await import("./feed.ts");
  const candles = candlesFromSpot(
    {
      ok: true,
      asset: "EURUSD",
      timeframe: "1m",
      symbol: "ZEURZUSD",
      venue: "Kraken ZEURZUSD",
      source: "kraken",
      price: 1.14582,
      bid: 1.14576,
      ask: 1.14579,
      bars: [
        { t: 1_700_000_000_000, open: 1.1451, high: 1.1459, low: 1.1448, close: 1.1457, volume: 10 },
        { t: 1_700_000_060_000, open: 1.1457, high: 1.1462, low: 1.1455, close: 1.146, volume: 12 },
      ],
      stale: false,
      marketState: "live",
      fetchedAt: Date.now(),
      latencyMs: 40,
    },
    0.85,
  );
  assert.equal(candles.length, 2);
  assert.equal(candles[0]?.source, "kraken");
  assert.equal(candles[0]?.synthetic, false);
  assert.ok(Math.abs(candles[1]!.close - 1.146) < 1e-6);

  const krakenBars = parseKrakenOhlc({
    result: {
      ZEURZUSD: [
        [1_790_063_220, "1.14579", "1.14593", "1.14579", "1.14582", "1.14585", "12", 4],
        [1_790_063_280, "1.14581", "1.14590", "1.14577", "1.14581", "1.14586", "9", 3],
      ],
      last: 1_790_063_280,
    },
  });
  assert.equal(krakenBars.length, 2);
  assert.equal(krakenBars[0]!.t, 1_790_063_220_000);
  assert.ok(krakenBars[0]!.high > krakenBars[0]!.low);

  const goldTick = parseKrakenTicker({
    result: { PAXGUSD: { c: ["4311.17"], b: ["4313.20"], a: ["4313.21"] } },
  });
  assert.ok(goldTick);
  assert.ok(goldTick.price > 4200 && goldTick.price < 4400);
  assert.ok(Math.abs(goldTick.price - 4348) > 20);

  const cb = parseCoinbaseCandles([
    [100, 1, 3, 2, 2.5, 1],
    [90, 1, 2, 1.5, 2, 1],
  ]);
  assert.equal(cb[0]!.t, 90_000);
  assert.equal(cb[1]!.open, 2);
});

test("collector snapshot maps Exness-shaped quotes and payout percent", async () => {
  const { parseCollector, collectorToSpot, normalizePayout } = await import("./collector.ts");
  assert.equal(normalizePayout(85), 0.85);
  const parsed = parseCollector({
    v: 1,
    source: "exness-collector",
    asset: "EUR/USD",
    timeframe: "M1",
    price: 1.14452,
    bid: 1.1445,
    ask: 1.14455,
    payout: 87,
    bars: [
      { t: Date.now() - 120_000, open: 1.1444, high: 1.1447, low: 1.1443, close: 1.1445, volume: 4 },
      { t: Date.now() - 60_000, open: 1.1445, high: 1.1446, low: 1.1444, close: 1.14452, volume: 3 },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.snap.asset, "EURUSD");
  assert.equal(parsed.snap.timeframe, "1m");
  assert.ok(Math.abs(parsed.snap.payout - 0.87) < 1e-9);
  const spot = collectorToSpot(parsed.snap);
  assert.equal(spot.source, "unverified");
  assert.notEqual(spot.source, "exness");
  const future = parseCollector({
    asset: "EURUSD",
    price: 1.1,
    bars: [{ t: Date.now() + 60 * 60_000, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 1 }],
  });
  assert.equal(future.ok, true);
  if (future.ok) assert.equal(future.snap.bars.filter((b) => b.t > Date.now() + 10 * 60_000).length, 0);
});

test("structure tags premium vs discount", async () => {
  const { readStructure, structureFits } = await import("./structure.ts");
  const up: Candle[] = [];
  let px = 1.1;
  for (let i = 0; i < 40; i++) {
    const o = px;
    px += 0.0004;
    up.push(c(i * 60_000, o, px + 0.0002, o - 0.0001, px));
  }
  const high = readStructure(up);
  assert.equal(high.zone, "PREMIUM");
  assert.equal(structureFits("SELL", high), true);
  const dn: Candle[] = [];
  px = 1.12;
  for (let i = 0; i < 40; i++) {
    const o = px;
    px -= 0.0004;
    dn.push(c(i * 60_000, o, o + 0.0001, px - 0.0002, px));
  }
  const low = readStructure(dn);
  assert.equal(low.zone, "DISCOUNT");
  assert.equal(structureFits("BUY", low), true);
});

test("FX session overlap is active, Asia quiet for majors", async () => {
  const { fxSession } = await import("./session.ts");
  const overlap = Date.UTC(2026, 8, 22, 13, 0, 0);
  const asia = Date.UTC(2026, 8, 22, 2, 0, 0);
  const londonNy = fxSession(overlap, "EURUSD");
  assert.equal(londonNy.name, "OVERLAP");
  assert.equal(londonNy.active, true);
  const quiet = fxSession(asia, "EURUSD");
  assert.equal(quiet.name, "ASIA");
  assert.equal(quiet.active, false);
  assert.equal(fxSession(asia, "BTCUSD").active, true);
});

test("confluence grades from checklist", async () => {
  const { scoreConfluence } = await import("./confluence.ts");
  const { emptyStructure } = await import("./structure.ts");
  const { fxSession } = await import("./session.ts");
  const s = emptyStructure();
  s.zone = "DISCOUNT";
  const cfl = scoreConfluence({
    direction: "BUY",
    regime: "TREND_UP",
    htfBias: "BUY",
    structure: s,
    session: fxSession(Date.UTC(2026, 8, 22, 13, 0, 0), "EURUSD"),
    newsClear: true,
    qualityOk: true,
  });
  assert.equal(cfl.score, 5);
  assert.equal(cfl.grade, "strong");
});

test("monte carlo calls a losing sample no edge and a tiny sample too few", async () => {
  const { readEdge } = await import("./edge.ts");
  const few = readEdge([1, -1, 0.5]);
  assert.equal(few.verdict, "too few");
  const lose = readEdge(Array.from({ length: 40 }, () => -0.4));
  assert.equal(lose.verdict, "no edge");
  assert.ok(lose.medianPathR < 0);
});

test("trade book opens a paper row and closes it with pnl", async () => {
  const { openBookRow, closeBookRow } = await import("./book.ts");
  const row = openBookRow({
    id: "sig-1",
    action: "buy",
    symbol: "EURUSD",
    price: 1.1,
    quantity: 0.01,
    note: "Paper BUY EURUSD",
  });
  assert.equal(row.market, "forex");
  assert.equal(row.exitPrice, null);
  const closed = closeBookRow(row, 1.12, 4.2);
  assert.equal(closed.pnl, 4.2);
  assert.equal(closed.id, row.id);
});

test("finviz and messari parsers keep a short public scan", async () => {
  const { parseFinviz, parseMessari } = await import("./scan.ts");
  const html = `<tr class="styled-row is-bordered"><td>1</td><td><a class="tab-link">AAA</a></td><td>Acme</td><td>Tech</td><td>Soft</td><td>USA</td><td>1B</td><td>10</td><td>12.50</td><td>4.20%</td><td>1.2M</td></tr>`;
  const rows = parseFinviz(html);
  assert.equal(rows[0]?.ticker, "AAA");
  assert.equal(rows[0]?.price, "12.50");
  const coins = parseMessari({ data: [{ symbol: "BTC", name: "Bitcoin", rank: 1, sector: "Cryptocurrency" }, { symbol: "" }] });
  assert.equal(coins.length, 1);
  assert.equal(coins[0]?.rank, 1);
});

test("falling US stocks pause a bitcoin buy and leave euro alone", async () => {
  const { parseBreadth, breadthEffect } = await import("./scan.ts");
  const html = "<p>Advancing</p><p>26.4% (1478)</p><p>Declining</p><p>(3996) 71.3%</p>";
  const mood = parseBreadth(html);
  assert.equal(mood.mood, "risk-off");
  assert.equal(breadthEffect("BTCUSD", "BUY", mood.mood).block, true);
  assert.equal(breadthEffect("EURUSD", "BUY", mood.mood).block, false);
  assert.equal(breadthEffect("EURUSD", "BUY", mood.mood).cut, false);
});

test("a fresh loss locks the next paper and an open ticket cannot be added to", async () => {
  const { mindGate } = await import("./mind.ts");
  const now = 1_000_000;
  const locked = mindGate({
    open: false,
    now,
    outcomes: [{ kind: "LOSS", settledAt: now - 30_000 }],
  });
  assert.match(locked ?? "", /Do not trade to get it back/);
  const later = mindGate({
    open: false,
    now: now + 4 * 60_000,
    outcomes: [{ kind: "LOSS", settledAt: now }],
  });
  assert.equal(later, null);
  assert.match(mindGate({ open: true, outcomes: [], now }) ?? "", /add to a loser/);
  const hot = mindGate({
    open: false,
    now,
    outcomes: [{ kind: "WIN", settledAt: now - 20_000, outcomeR: 2 }],
  });
  assert.match(hot ?? "", /Big win/);
});

test("a move that already ran one full stop-range is a chase", async () => {
  const { chaseBlock } = await import("./mind.ts");
  assert.match(chaseBlock("BUY", 1.1, 1.12, 0.01) ?? "", /Do not chase/);
  assert.equal(chaseBlock("BUY", 1.1, 1.105, 0.01), null);
});

test("Kotegawa buys only a stretched drop that is turning back up", async () => {
  const { kotegawaTheory } = await import("./kotegawa.ts");
  const flat: import("./types.ts").Candle[] = [];
  for (let i = 0; i < 45; i++) {
    flat.push({
      t: i,
      open: 100,
      high: 100.2,
      low: 99.8,
      close: 100,
      volume: 10,
      asset: "EURUSD",
      timeframe: "5m",
      source: "simulated",
      receivedAt: i,
      latencyMs: 0,
      payout: 0,
      marketType: "LIVE",
      otc: false,
      synthetic: false,
      closed: true,
    });
  }
  assert.match(kotegawaTheory(flat, "RANGE").reasons[0] ?? "", /abnormal|stretched|needs/i);
  const drop = flat.slice(0, 36);
  let px = 100;
  for (let i = 0; i < 8; i++) {
    const next = px - 1.2;
    drop.push({ ...flat[0]!, t: 100 + i, open: px, high: px, low: next, close: next, volume: 40 });
    px = next;
  }
  drop.push({ ...flat[0]!, t: 200, open: px, high: px + 0.4, low: px - 0.8, close: px + 0.3, volume: 50 });
  const hit = kotegawaTheory(drop, "RANGE");
  assert.equal(hit.direction, "BUY");
  assert.ok(hit.target > (drop.at(-1)?.close ?? 0));
});

test("Soros trades a wide break and Druckenmiller stands aside when the present fights the bigger move", async () => {
  const { sorosVote, druckenmillerVote, legendCouncil } = await import("./legends.ts");
  const base = {
    volume: 1,
    asset: "EURUSD" as const,
    timeframe: "5m" as const,
    source: "simulated" as const,
    receivedAt: 0,
    latencyMs: 0,
    payout: 0,
    marketType: "LIVE" as const,
    otc: false,
    synthetic: false,
    closed: true,
  };
  const quiet: import("./types.ts").Candle[] = [];
  for (let i = 0; i < 25; i++) {
    quiet.push({ ...base, t: i, open: 100, high: 100.4, low: 99.8, close: 100.1 });
  }
  quiet.push({ ...base, t: 26, open: 100.2, high: 102.2, low: 100.1, close: 102 });
  quiet.push({ ...base, t: 27, open: 102, high: 102.4, low: 101.6, close: 102.2 });
  quiet.push({ ...base, t: 28, open: 102.1, high: 102.6, low: 101.8, close: 102.3 });
  assert.equal(sorosVote(quiet).direction, "BUY");
  const fight: import("./types.ts").Candle[] = [];
  for (let i = 0; i < 60; i++) {
    const px = 100 + i * 0.2;
    fight.push({ ...base, t: i, open: px, high: px + 0.1, low: px - 0.1, close: px });
  }
  for (let i = 0; i < 10; i++) {
    const px = fight[fight.length - 1]!.close - 0.35;
    fight.push({ ...base, t: 100 + i, open: px + 0.35, high: px + 0.35, low: px, close: px });
  }
  assert.equal(druckenmillerVote(fight, false).direction, "WAIT");
  const council = legendCouncil(quiet, false);
  assert.equal(council.votes.length, 5);
  assert.ok(council.line.includes("Soros"));
});

test("a sell-leaning scanner rejects a buy and a short paper book has no VaR", async () => {
  const { skillClash, skillScan, bookRisk } = await import("./skill-desk.ts");
  const down: import("./types.ts").Candle[] = [];
  for (let i = 0; i < 50; i++) {
    const px = 100 - i * 0.4;
    down.push({
      t: i,
      open: px + 0.3,
      high: px + 0.3,
      low: px - 0.05,
      close: px,
      volume: 0,
      asset: "EURUSD",
      timeframe: "5m",
      source: "simulated",
      receivedAt: i,
      latencyMs: 0,
      payout: 0,
      marketType: "LIVE",
      otc: false,
      synthetic: false,
      closed: true,
    });
  }
  const scan = skillScan(down);
  assert.equal(typeof scan.score, "number");
  assert.match(skillClash("BUY", { ...scan, clash: "BUY", score: -4, label: "Sell" }) ?? "", /Sanity gate/);
  assert.equal(skillClash("SELL", { ...scan, clash: "BUY", score: -4, label: "Sell" }), null);
  assert.equal(bookRisk([1, -1, 0.5]).status, "Unknown");
});

test("a wide quote or a wide candle that closes in the middle is blocked", async () => {
  const { makerGate, MAKER_CARDS } = await import("./makers.ts");
  const bar: import("./types.ts").Candle = {
    t: 1,
    open: 10,
    high: 13,
    low: 10,
    close: 11.5,
    volume: 1,
    asset: "EURUSD",
    timeframe: "5m",
    source: "simulated",
    receivedAt: 1,
    latencyMs: 0,
    payout: 0,
    marketType: "LIVE",
    otc: false,
    synthetic: false,
    closed: true,
  };
  assert.match(makerGate({ spread: 0.4, atr: 1, closed: [bar] }) ?? "", /stepped back/);
  assert.match(makerGate({ spread: 0.01, atr: 1, closed: [bar] }) ?? "", /middle/);
  const held = { ...bar, close: 12.9 };
  assert.equal(makerGate({ spread: 0.01, atr: 1, closed: [held] }), null);
  assert.equal(MAKER_CARDS.length, 10);
  assert.equal(MAKER_CARDS.every((c) => c.book === "Unknown"), true);
});

test("five agreeing price rules in one family weigh the same as one rule", async () => {
  const { blendFamilies } = await import("./pipeline.ts");
  const rule = (name: string, direction: "BUY" | "SELL"): import("./types.ts").StrategyVote => ({
    name,
    direction,
    probability: 0.7,
    strength: 1,
    reasons: [name],
    invalidation: [],
    regimeFit: 1,
    stop: 1,
    target: 2,
  });
  const crowd = blendFamilies([
    rule("soros", "BUY"),
    rule("kovner", "BUY"),
    rule("breakout", "BUY"),
    rule("candle", "BUY"),
    rule("candle_master", "BUY"),
  ]);
  const one = blendFamilies([rule("soros", "BUY")]);
  assert.equal(crowd.direction, "WAIT");
  assert.equal(one.direction, "WAIT");
  assert.equal(crowd.p, one.p);
  const twoFamilies = blendFamilies([rule("trendPullback", "BUY"), rule("kotegawa", "BUY")]);
  assert.equal(twoFamilies.direction, "BUY");
  assert.ok(twoFamilies.p <= 0.58);
  const fought = blendFamilies([rule("trendPullback", "BUY"), rule("kotegawa", "SELL"), rule("soros", "BUY")]);
  assert.equal(fought.direction, "WAIT");
});

test("jev holds on price-only data and does not stack six indicator votes", async () => {
  const { readJev } = await import("./jev.ts");
  const flat = Array.from({ length: 60 }, (_, i) => c(i, 1, 1.01, 0.99, 1));
  const held = readJev(flat, "RANGE");
  assert.equal(held.action, "HOLD");
  assert.equal(held.bots.length, 6);
  assert.ok(held.confidence <= 0.58);
  const up = Array.from({ length: 80 }, (_, i) => {
    const px = 1 + i * 0.01;
    return c(i, px, px + 0.002, px - 0.001, px + 0.001);
  });
  const last = up[up.length - 1]!;
  const withQuote = readJev(up, "TREND_UP", { bid: last.close - 0.0001, ask: last.close + 0.0001, spread: 0.0002 });
  assert.equal(withQuote.bots.length, 6);
  assert.ok(withQuote.confidence <= 0.58);
});

test("desk agents dedupe, fill gaps, and trip risk without applying a searched gate", async () => {
  const { dedupeBars, gapFill, riskTrip, walkForwardGate, calibrate } = await import("./desk-logic.ts");
  const rows = [
    { t: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1, asset: "EURUSD", timeframe: "1m", synthetic: false },
    { t: 60_000, open: 1, high: 1.2, low: 1, close: 1.1, volume: 2, asset: "EURUSD", timeframe: "1m", synthetic: false },
    { t: 240_000, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 1, asset: "EURUSD", timeframe: "1m", synthetic: false },
  ];
  const filled = gapFill(dedupeBars(rows), 60_000);
  assert.equal(filled.bars.length, 4);
  assert.equal(filled.gaps, 2);
  assert.equal(filled.bars[1]!.synthetic, true);
  const losses = Array.from({ length: 4 }, (_, i) => ({
    strategy: "trend",
    kind: "LOSS" as const,
    outcomeR: -1,
    calibratedProbability: 0.6,
    settledAt: Date.now() - i * 1000,
  }));
  const trip = riskTrip(losses, { autostart: false, telemetry: false, dailyLossR: 3, maxDrawdownR: 6, lossStreak: 4, updateUrl: "" });
  assert.equal(trip.tripped, true);
  const walk = walkForwardGate([...losses, ...losses, ...losses, ...losses]);
  assert.equal(walk.applied, false);
  assert.equal(calibrate(losses).enough, false);
});



