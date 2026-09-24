import type { AssetId, Candle, MarketType, Timeframe } from "./types.ts";
import { ASSETS, TIMEFRAME_SEC, assetMeta } from "./constants.ts";
import { gaussian, mulberry32 } from "./rng.ts";
import { applyTick, bucketTs, makeCandle, periodMs, roundPrice } from "./candles.ts";
import type { Regime } from "./types.ts";

const REGIMES: Regime[] = [
  "TREND_UP",
  "TREND_DOWN",
  "RANGE",
  "EXPANSION",
  "HIGH_VOLATILITY",
  "DEAD",
  "MIXED",
];

export interface MarketBook {
  asset: AssetId;
  timeframe: Timeframe;
  candles: Candle[];
  forming: Candle | null;
  price: number;
  payout: number;
  marketType: MarketType;
  otc: boolean;
  regime: Regime;
  seed: number;
  bid: number | null;
  ask: number | null;
  venue: string;
}

function driftFor(regime: Regime, vol: number) {
  switch (regime) {
    case "TREND_UP":
      return vol * 0.35;
    case "TREND_DOWN":
      return -vol * 0.35;
    case "EXPANSION":
      return vol * 0.2;
    case "HIGH_VOLATILITY":
      return 0;
    case "DEAD":
      return 0;
    case "RANGE":
      return 0;
    default:
      return 0;
  }
}

function volMul(regime: Regime) {
  if (regime === "HIGH_VOLATILITY" || regime === "EXPANSION") return 1.8;
  if (regime === "DEAD" || regime === "RANGE") return 0.55;
  return 1;
}

export function generateHistory(opts: {
  asset: AssetId;
  timeframe: Timeframe;
  bars: number;
  seed?: number;
  endTs?: number;
  otc?: boolean;
}): MarketBook {
  const meta = assetMeta(opts.asset);
  const rand = mulberry32(opts.seed ?? 0x51ed);
  const tf = opts.timeframe;
  const ms = periodMs(tf);
  const end = bucketTs(opts.endTs ?? Date.now(), tf);
  let px = meta.start;
  let regime: Regime = "MIXED";
  let regimeLeft = 40;
  const candles: Candle[] = [];
  const otc = !!opts.otc;
  for (let i = opts.bars; i >= 1; i--) {
    if (regimeLeft-- <= 0) {
      regime = REGIMES[Math.floor(rand() * REGIMES.length)]!;
      regimeLeft = 18 + Math.floor(rand() * 40);
    }
    const vol = meta.vol * volMul(regime);
    const d = driftFor(regime, vol);
    const shock = gaussian(rand) * vol;
    const ret = d + shock;
    const open = px;
    const path: number[] = [open];
    for (let k = 0; k < 4; k++) path.push(path[path.length - 1]! * (1 + gaussian(rand) * vol * 0.6));
    const close = Math.max(1e-6, open * (1 + ret));
    path.push(close);
    const high = Math.max(...path);
    const low = Math.min(...path);
    const t = end - i * ms;
    const payout = 0.78 + rand() * 0.12;
    candles.push(
      makeCandle({
        t,
        open,
        high,
        low,
        close,
        volume: 80 + rand() * 400,
        asset: opts.asset,
        timeframe: tf,
        source: "simulated",
        receivedAt: t + 8 + rand() * 40,
        latencyMs: 8 + rand() * 40,
        payout,
        marketType: otc ? "OTC" : "LIVE",
        otc,
        synthetic: true,
        closed: true,
      }),
    );
    px = close;
  }
  return {
    asset: opts.asset,
    timeframe: tf,
    candles,
    forming: null,
    price: px,
    payout: candles[candles.length - 1]?.payout ?? 0.85,
    marketType: otc ? "OTC" : "LIVE",
    otc,
    regime,
    seed: opts.seed ?? 0x51ed,
    bid: null,
    ask: null,
    venue: "simulated",
  };
}

export function stepMarket(book: MarketBook, now: number, rand: () => number): MarketBook {
  const meta = assetMeta(book.asset);
  const vol = meta.vol * volMul(book.regime) * 0.22;
  const d = driftFor(book.regime, vol);
  const next = Math.max(1e-8, book.price * (1 + d + gaussian(rand) * vol));
  const px = roundPrice(book.asset, next);
  const t = now;
  const bucket = bucketTs(t, book.timeframe);
  const formingPrev = book.forming;
  const closed = [...book.candles];
  if (formingPrev && formingPrev.t !== bucket) {
    closed.push({ ...formingPrev, closed: true, close: formingPrev.close });
    if (closed.length > 1200) closed.splice(0, closed.length - 1200);
  }
  const forming = applyTick(
    formingPrev && formingPrev.t === bucket ? formingPrev : null,
    px,
    t,
    book.timeframe,
    book.asset,
  );
  forming.payout = book.payout;
  forming.otc = book.otc;
  forming.marketType = book.marketType;
  forming.synthetic = true;
  if (rand() < 0.004) {
    book.payout = Math.max(0.72, Math.min(0.93, book.payout + (rand() - 0.5) * 0.04));
  }
  if (rand() < 0.002) {
    const idx = Math.floor(rand() * REGIMES.length);
    book.regime = REGIMES[idx]!;
  }
  return {
    ...book,
    candles: closed,
    forming,
    price: px,
  };
}

export function bookFromSpot(
  candles: Candle[],
  opts: {
    asset: AssetId;
    timeframe: Timeframe;
    price: number;
    payout?: number;
    stale?: boolean;
    bid?: number | null;
    ask?: number | null;
    venue?: string;
  },
): MarketBook {
  const last = candles[candles.length - 1];
  const forming = last && last.closed === false ? last : null;
  const closed = forming ? candles.slice(0, -1) : candles;
  return {
    asset: opts.asset,
    timeframe: opts.timeframe,
    candles: closed,
    forming,
    price: opts.price,
    payout: opts.payout ?? last?.payout ?? 0.85,
    marketType: "LIVE",
    otc: false,
    regime: "MIXED",
    seed: 0,
    bid: opts.bid ?? null,
    ask: opts.ask ?? null,
    venue: opts.venue ?? last?.source ?? "yahoo",
  };
}

export function applySpot(book: MarketBook, price: number, now: number, synthetic = false): MarketBook {
  const px = roundPrice(book.asset, price);
  const bucket = bucketTs(now, book.timeframe === "15s" ? book.timeframe : book.timeframe);
  const formingPrev = book.forming;
  const closed = [...book.candles];
  if (formingPrev && formingPrev.t !== bucket) {
    closed.push({ ...formingPrev, closed: true, close: formingPrev.close, synthetic: formingPrev.synthetic });
    if (closed.length > 1200) closed.splice(0, closed.length - 1200);
  }
  const forming = applyTick(
    formingPrev && formingPrev.t === bucket ? formingPrev : null,
    px,
    now,
    book.timeframe,
    book.asset,
  );
  forming.payout = book.payout;
  forming.otc = false;
  forming.marketType = "LIVE";
  forming.synthetic = synthetic;
  forming.source = synthetic ? "simulated" : "yahoo";
  return { ...book, candles: closed, forming, price: px };
}

export function secondsLeft(tf: Timeframe, now = Date.now()) {
  const ms = periodMs(tf);
  return Math.max(0, (ms - (now % ms)) / 1000);
}

export { TIMEFRAME_SEC };
