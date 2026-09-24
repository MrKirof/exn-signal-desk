import type { Candle, Direction, Features, LabSettings, NewsEvent, Signal, StrategyVote } from "./types.ts";
import {
  DATA_QUALITY_MIN,
  FEATURE_VERSION,
  MODEL_VERSION,
  STRATEGY_VERSION,
  WARMUP_BARS,
  assetMeta,
} from "./constants.ts";
import { ACTION, isTrade, signalKey } from "./actions.ts";
import { calibrationStatus, expectedValue as evFn, gateTrade } from "./ev.ts";
import { detectRegime, htfConflict, htfContext } from "./regime.ts";
import { confirmLive, runStrategies } from "./strategies.ts";
import { extractFeatures } from "./features.ts";
import { calibrate, emptyModel as emptyM, predictRaw } from "./models.ts";
import type { ModelRecord } from "./types.ts";
import { estimateCosts, spreadFor } from "./costs.ts";
import { minutesToNews, newsBlock, readWire, type WireHit } from "./news.ts";
import { breadthEffect, type MarketMood } from "./scan.ts";
import { chaseBlock } from "./mind.ts";
import { clockBreach } from "./temporal.ts";
import { kotegawaTheory } from "./kotegawa.ts";
import { legendCouncil } from "./legends.ts";
import { skillClash, skillScan } from "./skill-desk.ts";
import { makerGate } from "./makers.ts";
import { uid } from "./rng.ts";
import { atr } from "./indicators.ts";
import { periodMs } from "./candles.ts";
import { readStructure, emptyStructure } from "./structure.ts";
import { fxSession, emptySession } from "./session.ts";
import { scoreConfluence, emptyConfluence } from "./confluence.ts";
import { emptyCandleScan, scanCandles } from "./candles-master.ts";
import { jevAgrees, readJev } from "./jev.ts";

export type PriceFamily = "trend" | "reversion" | "structure";

/** Same close/high/low series. Names do not make these independent. */
export function priceFamily(name: string): PriceFamily {
  const n = name.toLowerCase();
  if (n.includes("range") || n.includes("reversion") || n.includes("kotegawa") || n.includes("krieger")) return "reversion";
  if (n.includes("breakout") || n.includes("candle") || n.includes("soros") || n.includes("kovner")) return "structure";
  return "trend";
}

export function blendFamilies(votes: StrategyVote[]): {
  direction: Direction;
  p: number;
  strength: number;
  pick: StrategyVote | null;
  note: string;
} {
  const families: PriceFamily[] = ["trend", "reversion", "structure"];
  const side: Record<PriceFamily, Direction> = { trend: ACTION.WAIT, reversion: ACTION.WAIT, structure: ACTION.WAIT };
  const pickOf: Record<PriceFamily, StrategyVote | null> = { trend: null, reversion: null, structure: null };
  for (const fam of families) {
    const group = votes.filter((v) => isTrade(v.direction) && priceFamily(v.name) === fam);
    const buys = group.filter((v) => v.direction === ACTION.BUY);
    const sells = group.filter((v) => v.direction === ACTION.SELL);
    if (buys.length > 0 && sells.length > 0) continue;
    const pack = buys.length > 0 ? buys : sells;
    if (pack.length === 0) continue;
    const best = [...pack].sort((a, b) => b.strength * b.regimeFit - a.strength * a.regimeFit)[0]!;
    side[fam] = best.direction;
    pickOf[fam] = best;
  }
  const buyN = families.filter((f) => side[f] === ACTION.BUY).length;
  const sellN = families.filter((f) => side[f] === ACTION.SELL).length;
  const note = `One price series. Families ${buyN} buy / ${sellN} sell. Extra rule names are not extra evidence.`;
  if (buyN >= 2 && sellN === 0) {
    return {
      direction: ACTION.BUY,
      p: Math.min(0.58, 0.5 + 0.03 * buyN),
      strength: buyN / 3,
      pick: pickOf.trend ?? pickOf.structure ?? pickOf.reversion,
      note,
    };
  }
  if (sellN >= 2 && buyN === 0) {
    return {
      direction: ACTION.SELL,
      p: Math.min(0.58, 0.5 + 0.03 * sellN),
      strength: sellN / 3,
      pick: pickOf.trend ?? pickOf.structure ?? pickOf.reversion,
      note,
    };
  }
  return { direction: ACTION.WAIT, p: 0.5, strength: Math.max(buyN, sellN) / 3, pick: null, note };
}

export function blendVotes(votes: StrategyVote[]): { direction: Direction; p: number; strength: number; pick: StrategyVote | null } {
  const fam = blendFamilies(votes);
  return { direction: fam.direction, p: fam.p, strength: fam.strength, pick: fam.pick };
}

export function similarWinRate(history: { p: number; win: boolean }[], p: number): { wr: number | null; n: number } {
  const rows = history.filter((h) => Math.abs(h.p - p) <= 0.03);
  if (rows.length < 8) return { wr: null, n: rows.length };
  return { wr: rows.filter((r) => r.win).length / rows.length, n: rows.length };
}

export function analyze(opts: {
  closed: Candle[];
  forming: Candle | null;
  settings: LabSettings;
  model: ModelRecord;
  news: NewsEvent[];
  quality: number;
  sampleSize: number;
  similar: { wr: number | null; n: number };
  recentHit: number;
  spread?: number;
  now?: number;
  wire?: WireHit[];
  mood?: MarketMood;
  bid?: number | null;
  ask?: number | null;
}): { signal: Signal; computeMs: number } {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = opts.now ?? Date.now();
  const closed = opts.closed;
  const last = closed[closed.length - 1];
  const asset = last?.asset ?? "EURUSD";
  const timeframe = last?.timeframe ?? "1m";
  const spec = assetMeta(asset);
  const a =
    last != null
      ? atr(closed.map((c) => c.high), closed.map((c) => c.low), closed.map((c) => c.close), 14) ?? spec.pip * 8
      : spec.pip * 8;
  const spread = opts.spread ?? spreadFor(asset, a);

  const baseSignal = (partial: Partial<Signal>): Signal => ({
    predictionId: uid("pred"),
    signalKey: signalKey({
      asset,
      timeframe,
      candleStart: last?.t ?? 0,
      strategy: "none",
      direction: ACTION.WAIT,
    }),
    lifecycle: "COLLECTING",
    direction: ACTION.WAIT,
    rawScore: 0,
    rawProbability: 0.5,
    calibratedProbability: 0.5,
    calibrationStatus: calibrationStatus(opts.similar.n),
    historicalWinRate: opts.similar.wr,
    sampleSize: opts.similar.n,
    expectedValue: 0,
    expectedValueR: 0,
    entryPrice: last?.close ?? 0,
    stopPrice: 0,
    targetPrice: 0,
    createdAt: now,
    validUntil: now + periodMs(timeframe),
    ageMs: 0,
    regime: "MIXED",
    dataQuality: opts.quality,
    reasons: [],
    against: [],
    invalidation: [],
    recommendedStake: 0,
    recommendedLots: 0,
    suggestedLeverage: 0,
    marginUsd: 0,
    notionalUsd: 0,
    dailyRiskUsed: 0,
    strategies: [],
    features: emptyFeatures(),
    modelVersion: MODEL_VERSION,
    strategyVersion: STRATEGY_VERSION,
    featureVersion: FEATURE_VERSION,
    cancelledReason: null,
    asset,
    timeframe,
    marketType: last?.marketType ?? "LIVE",
    otc: last?.otc ?? false,
    synthetic: last?.synthetic ?? true,
    session: emptySession(),
    structure: emptyStructure(),
    confluence: emptyConfluence(),
    pendingDirection: ACTION.WAIT,
    candle: emptyCandleScan(),
    jev: null,
    ...partial,
  });

  const done = (signal: Signal) => ({
    signal,
    computeMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
  });

  if (closed.length < WARMUP_BARS) {
    return done(baseSignal({ reasons: [`Collecting closed candles (${closed.length}/${WARMUP_BARS})`] }));
  }
  if (opts.quality < DATA_QUALITY_MIN) {
    return done(
      baseSignal({
        lifecycle: "ANALYZING",
        cancelledReason: "WAIT — data quality insufficient",
        against: [`data quality ${(opts.quality * 100).toFixed(0)}% < ${DATA_QUALITY_MIN * 100}%`],
        reasons: [],
      }),
    );
  }

  const { regime, stable, why: regimeWhy } = detectRegime(closed);
  const htf = htfContext(closed);
  const web = readWire(opts.wire ?? [], asset, now);
  const calendarWhy = opts.settings.newsFilter ? newsBlock(opts.news, asset, now) : null;
  const newsWhy = calendarWhy ?? (opts.settings.newsFilter && web.level === "block" ? web.why : null);
  const newsMin = minutesToNews(opts.news, asset, now);
  const structure = readStructure(closed);
  const session = fxSession(now, asset);
  const features =
    extractFeatures(closed, {
      newsMin: Math.max(0, Math.min(1, Math.abs(newsMin) / 180)),
      recentHit: opts.recentHit,
      timeToClose: opts.forming ? 0.4 : 1,
    }) ?? emptyFeatures();
  const votes = runStrategies(closed, regime);
  const candle = scanCandles(closed, regime, structure, session.active);
  const kote = kotegawaTheory(closed, regime);
  const legends = legendCouncil(closed, session.active, web.level === "block");
  const scan = skillScan(closed);
  const blend = blendFamilies([...votes, kote]);
  const moodHit = breadthEffect(asset, blend.direction, opts.mood ?? "unknown");
  const rawModel = predictRaw(opts.model, features);
  const dirP0 =
    blend.direction === ACTION.WAIT
      ? 0.5
      : 0.55 * blend.p + 0.45 * (blend.direction === ACTION.BUY ? rawModel : 1 - rawModel);
  const shrunk = web.level === "caution" || moodHit.cut;
  const dirP = shrunk ? 0.5 + (dirP0 - 0.5) * 0.82 : dirP0;
  const calibrated = calibrate(opts.model, dirP);
  const live = confirmLive(blend.direction, opts.forming, closed);

  const reasons: string[] = [];
  const against: string[] = [];
  for (const v of votes) {
    if (v.direction === blend.direction && v.direction !== ACTION.WAIT) reasons.push(...v.reasons);
    if (v.direction !== ACTION.WAIT && v.direction !== blend.direction) against.push(...v.reasons);
  }
  if (newsWhy) against.push(newsWhy);
  else if (web.level === "caution" && web.why) against.push(web.why);
  reasons.push(web.line);
  if (last?.synthetic) against.push("Synthetic/reconstructed candles");
  if (!stable) against.push(regimeWhy);
  if (htf.why) reasons.push(htf.why);
  reasons.push(regimeWhy);
  reasons.unshift(legends.line);
  reasons.unshift(blend.note);
  reasons.unshift(`Scanner ${scan.score} · ${scan.label} · ${scan.regime}`);
  const clash = isTrade(blend.direction) ? skillClash(blend.direction, scan) : null;
  if (clash) against.push(`${clash} Same candles, so this is a note, not another vote.`);

  const pick = blend.pick;
  const entry = last!.close;
  const stop = pick?.stop ?? 0;
  const target = pick?.target ?? 0;
  const stopDist = Math.abs(entry - stop);
  const rr = stopDist > 0 ? Math.abs(target - entry) / stopDist : 0;
  const costs = isTrade(blend.direction)
    ? estimateCosts({ asset, entry, stop, atr: a, direction: blend.direction })
    : { acceptable: false, costR: 1, reason: "no setup", spread, stopDist, spreadOfStop: 1 };

  const winR = Math.max(1.2, rr || 1.6);
  const pTape =
    opts.similar.wr != null && opts.sampleSize >= 30 ? 0.35 * calibrated + 0.65 * opts.similar.wr : calibrated;
  const evR = evFn(pTape, winR, 1, costs.costR);
  const strict = opts.sampleSize < 30;
  const gate = gateTrade({
    calibrated: pTape,
    sampleSize: opts.sampleSize,
    dataQuality: opts.quality,
    evR,
    minEv: opts.settings.minEv,
    safetyMargin: opts.settings.safetyMargin + (strict ? 0.04 : 0),
    rr: rr || 0,
    costR: costs.costR,
  });

  let direction: Direction = live.direction;
  let cancelled: string | null = null;
  if (newsWhy) {
    direction = ACTION.WAIT;
    cancelled = newsWhy;
  } else if (!stable) {
    direction = ACTION.WAIT;
    cancelled = "WAIT — regime transition";
  } else if (live.status === "cancel") {
    direction = ACTION.WAIT;
    cancelled = live.why;
  } else if (isTrade(blend.direction) && makerGate({ spread, atr: a, closed })) {
    direction = ACTION.WAIT;
    cancelled = makerGate({ spread, atr: a, closed });
  } else if (!isTrade(blend.direction)) {
    direction = ACTION.WAIT;
    cancelled = blend.note;
    for (const v of votes) {
      if (v.reasons[0]) against.push(`${v.name.replaceAll("_", " ")}: ${v.reasons[0]}`);
    }
  } else if (htfConflict(blend.direction, htf) === "HIGH") {
    direction = ACTION.WAIT;
    cancelled = "WAIT — HTF conflict";
    against.push(htf.why);
  } else if (!costs.acceptable) {
    direction = ACTION.WAIT;
    cancelled = costs.reason ?? "WAIT — cost too high";
  } else if (!gate.ok) {
    direction = ACTION.WAIT;
    cancelled = gate.reasons[0] ?? "WAIT — no positive expectancy";
    against.push(...gate.reasons);
  } else {
    direction = blend.direction;
  }

  if (htf.bias !== ACTION.WAIT && direction !== ACTION.WAIT) reasons.unshift(htf.why);
  if (live.status === "confirm" && direction !== ACTION.WAIT) reasons.unshift("Live candle agrees");

  const candidate = isTrade(direction) ? direction : isTrade(blend.direction) ? blend.direction : ACTION.WAIT;
  const confluence = scoreConfluence({
    direction: candidate,
    regime,
    htfBias: htf.bias,
    structure,
    session,
    newsClear: !newsWhy,
    qualityOk: opts.quality >= DATA_QUALITY_MIN,
    candle,
  });
  if (candle.best && candle.best.score >= 0.5) {
    reasons.unshift(`${candle.best.name} ${candle.best.score.toFixed(2)}`);
  }
  if (strict && isTrade(direction) && confluence.score < 4) {
    against.unshift(`Strict filter · ${confluence.score}/6 checks · need 4 until 30 closed papers`);
    cancelled = `Strict filter · ${confluence.score}/6 until 30 papers`;
    direction = ACTION.WAIT;
  }
  if (moodHit.why) against.unshift(moodHit.why);
  if (moodHit.block && isTrade(direction)) {
    cancelled = moodHit.why;
    direction = ACTION.WAIT;
  }
  const quietFx = asset === "EURUSD" || asset === "GBPUSD" || asset === "USDJPY";
  if (isTrade(direction) && quietFx && !session.active) {
    cancelled = "Quiet session. No boredom trade.";
    direction = ACTION.WAIT;
  }
  const chase = chaseBlock(direction, entry, opts.forming?.close ?? entry, a);
  if (chase && isTrade(direction)) {
    cancelled = chase;
    direction = ACTION.WAIT;
  }
  const clock = last ? clockBreach(last.t, now) : "WAIT — bar clock is missing";
  if (clock && isTrade(direction)) {
    cancelled = clock;
    direction = ACTION.WAIT;
  }
  const jev = readJev(closed, regime, { spread, bid: opts.bid, ask: opts.ask });
  if (isTrade(direction) && !jevAgrees(direction, jev)) {
    cancelled = jev.note;
    against.unshift(jev.note);
    direction = ACTION.WAIT;
  } else if (jev.action !== "HOLD") {
    reasons.unshift(`Jev ${jev.action} · ${(jev.confidence * 100).toFixed(0)}% · ${jev.note}`);
  } else {
    reasons.unshift(`Jev HOLD · ${jev.note}`);
  }
  const lifecycle = direction === ACTION.WAIT ? "ANALYZING" : "READY";
  const pendingDirection = direction === ACTION.WAIT && isTrade(blend.direction) ? blend.direction : ACTION.WAIT;
  const planDir = direction === ACTION.WAIT ? pendingDirection : direction;
  if (structure.zone !== "EQUILIBRIUM") reasons.push(`Price in ${structure.zone.toLowerCase()}`);
  if (structure.bos !== "NONE") reasons.push(`Break of structure ${structure.bos}`);
  reasons.push(`${session.label}${session.active ? "" : " (quiet)"}`);
  if (confluence.grade === "strong" && isTrade(direction)) reasons.unshift(`Confluence ${confluence.score}/${confluence.max}`);
  const invalidation = votes.flatMap((v) => (v.direction === direction ? v.invalidation : []));
  const topName = pick?.name ?? "none";

  return done(
    baseSignal({
      signalKey: signalKey({
        asset,
        timeframe,
        candleStart: last!.t,
        strategy: topName,
        direction,
      }),
      lifecycle,
      direction,
      rawScore: blend.strength,
      rawProbability: dirP,
      calibratedProbability: opts.sampleSize < 30 ? calibrated : pTape,
      calibrationStatus: calibrationStatus(opts.similar.n),
      expectedValue: evR,
      expectedValueR: evR,
      stopPrice: planDir === ACTION.WAIT ? 0 : stop,
      targetPrice: planDir === ACTION.WAIT ? 0 : target,
      regime,
      reasons: unique(reasons).slice(0, 8),
      against: unique(against).slice(0, 8),
      invalidation: unique(invalidation).slice(0, 4),
      strategies: votes,
      features,
      cancelledReason: cancelled,
      session,
      structure,
      confluence,
      pendingDirection,
      candle,
      jev,
    }),
  );
}

function unique(xs: string[]) {
  return [...new Set(xs.filter(Boolean))];
}

export function emptyFeatures(): Features {
  return {
    version: FEATURE_VERSION,
    ret1: 0, ret3: 0, ret5: 0, ret10: 0, ret20: 0,
    bodyRatio: 0, upperWick: 0, lowerWick: 0, rangeAtr: 1, gapSize: 0,
    momAccel: 0, distHigh: 0.5, distLow: 0.5, swing: 0.5, breakout: 0,
    rsi: 0.5, rsiSlope: 0, rsiDiv: 0, macdHist: 0, macdSlope: 0,
    emaDist: 0, emaAlign: 0, bbPos: 0.5, bbWidth: 0.02, atrPct: 0.5,
    adx: 0.2, stoch: 0.5, cci: 0, roc: 0, vwapDist: 0,
    hour: 0.5, dow: 0.5, payout: 0, otc: 0, timeToClose: 0.5, newsMin: 1, recentHit: 0.5,
    efficiencyRatio: 0.3, atrExpansion: 1,
  };
}

export { emptyM as emptyModel };
