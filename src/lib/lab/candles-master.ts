import type { Candle, CandleHit, CandleRole, CandleScan, Direction, Regime, StructureInfo, StrategyVote } from "./types.ts";
import { ACTION } from "./actions.ts";
import { assetMeta } from "./constants.ts";
import { atr } from "./indicators.ts";
import { readStructure, structureFits } from "./structure.ts";

export function emptyCandleScan(): CandleScan {
  return { hits: [], best: null, priorTrend: "FLAT", rangeAtr: 0 };
}

interface Geom {
  o: number;
  h: number;
  l: number;
  c: number;
  range: number;
  body: number;
  upper: number;
  lower: number;
  bodyPct: number;
  upperPct: number;
  lowerPct: number;
  closePos: number;
  bull: boolean;
  bear: boolean;
}

function geom(bar: Candle): Geom {
  const range = Math.max(bar.high - bar.low, 1e-12);
  const body = Math.abs(bar.close - bar.open);
  const upper = bar.high - Math.max(bar.open, bar.close);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  return {
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close,
    range,
    body,
    upper,
    lower,
    bodyPct: body / range,
    upperPct: upper / range,
    lowerPct: lower / range,
    closePos: (bar.close - bar.low) / range,
    bull: bar.close >= bar.open,
    bear: bar.close < bar.open,
  };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function priorSlope(closed: Candle[], skip: number, atrN: number): "UP" | "DOWN" | "FLAT" {
  const slice = closed.slice(Math.max(0, closed.length - skip - 8), Math.max(0, closed.length - skip));
  if (slice.length < 4) return "FLAT";
  const first = slice[0]!.close;
  const last = slice[slice.length - 1]!.close;
  const move = (last - first) / Math.max(atrN, 1e-12);
  if (move > 0.35) return "UP";
  if (move < -0.35) return "DOWN";
  return "FLAT";
}

function bigEnough(g: Geom, atrN: number, spread: number) {
  return g.range >= atrN * 0.7 && g.range >= spread * 3;
}

function hit(
  id: string,
  name: string,
  bars: 1 | 2 | 3,
  direction: Direction,
  role: CandleRole,
  geometry: number,
  why: string,
): CandleHit {
  return { id, name, bars, direction, role, geometry: clamp01(geometry), context: 0, score: 0, why };
}

function detectGeometry(closed: Candle[], atrN: number, spread: number): CandleHit[] {
  if (closed.length < 5) return [];
  const a = closed[closed.length - 1]!;
  const b = closed[closed.length - 2]!;
  const c = closed[closed.length - 3];
  const g = geom(a);
  const p = geom(b);
  const q = c ? geom(c) : null;
  const out: CandleHit[] = [];

  if (bigEnough(g, atrN, spread) && g.lowerPct >= 0.62 && g.lower >= 2 * Math.max(g.body, g.range * 0.08) && g.upperPct <= 0.18 && g.bodyPct <= 0.35 && g.closePos >= 0.62) {
    const geo = 0.55 + Math.min(0.35, (g.lowerPct - 0.62) * 1.4) + (g.closePos >= 0.75 ? 0.08 : 0);
    out.push(hit("hammer", "Hammer / bullish pin", 1, ACTION.BUY, "reversal", geo, "Long lower shadow (≥2× body), close in upper third — buyers rejected the low"));
  }
  if (bigEnough(g, atrN, spread) && g.upperPct >= 0.62 && g.upper >= 2 * Math.max(g.body, g.range * 0.08) && g.lowerPct <= 0.18 && g.bodyPct <= 0.35 && g.closePos <= 0.38) {
    const geo = 0.55 + Math.min(0.35, (g.upperPct - 0.62) * 1.4) + (g.closePos <= 0.25 ? 0.08 : 0);
    out.push(hit("shooting_star", "Shooting star / bearish pin", 1, ACTION.SELL, "reversal", geo, "Long upper shadow (≥2× body), close in lower third — sellers rejected the high"));
  }
  if (bigEnough(g, atrN, spread) && g.bodyPct >= 0.78) {
    const geo = 0.5 + Math.min(0.35, (g.bodyPct - 0.78) * 1.5);
    out.push(
      hit(
        g.bull ? "bull_marubozu" : "bear_marubozu",
        g.bull ? "Bullish marubozu" : "Bearish marubozu",
        1,
        g.bull ? ACTION.BUY : ACTION.SELL,
        "continuation",
        geo,
        "Almost no shadow — one side owned the bar. Continuation, not a reversal.",
      ),
    );
  }
  if (g.bodyPct <= 0.12 && g.range >= atrN * 0.45 && g.lowerPct < 0.55 && g.upperPct < 0.55) {
    out.push(hit("doji", "Doji", 1, ACTION.WAIT, "indecision", 0.45, "Open ≈ close. Indecision — not a trade by itself"));
  }

  const engulfSize = g.body >= p.body * 1.1 && g.range >= atrN * 0.75;
  if (engulfSize && p.bear && g.bull && g.c >= p.o && g.o <= p.c) {
    const cover = (g.body - p.body) / Math.max(p.body, 1e-12);
    out.push(hit("bull_engulf", "Bullish engulfing", 2, ACTION.BUY, "reversal", 0.58 + Math.min(0.25, cover * 0.2), "Bull body covers prior bear body"));
  }
  if (engulfSize && p.bull && g.bear && g.o >= p.c && g.c <= p.o) {
    const cover = (g.body - p.body) / Math.max(p.body, 1e-12);
    out.push(hit("bear_engulf", "Bearish engulfing", 2, ACTION.SELL, "reversal", 0.58 + Math.min(0.25, cover * 0.2), "Bear body covers prior bull body"));
  }

  if (p.range >= atrN * 0.7 && g.range < p.range && g.h <= p.h && g.l >= p.l) {
    out.push(hit("inside_bar", "Inside bar", 2, ACTION.WAIT, "compression", 0.5, "Range inside mother bar — wait for expansion, no direction yet"));
  }

  if (p.bear && g.bull && g.c > (p.o + p.c) / 2 && g.c < p.o && g.o <= p.c && g.range >= atrN * 0.55) {
    out.push(hit("piercing", "Piercing line", 2, ACTION.BUY, "reversal", 0.56, "Bull close back through 50% of prior bear body"));
  }
  if (p.bull && g.bear && g.c < (p.o + p.c) / 2 && g.c > p.o && g.o >= p.c && g.range >= atrN * 0.55) {
    out.push(hit("dark_cloud", "Dark cloud cover", 2, ACTION.SELL, "reversal", 0.56, "Bear close back through 50% of prior bull body"));
  }

  if (p.bull && g.bear && g.body < p.body * 0.7 && g.c >= p.o && g.o <= p.c) {
    out.push(hit("bear_harami", "Bearish harami", 2, ACTION.WAIT, "compression", 0.48, "Small bear inside prior bull — stall, wait close"));
  }
  if (p.bear && g.bull && g.body < p.body * 0.7 && g.o >= p.c && g.c <= p.o) {
    out.push(hit("bull_harami", "Bullish harami", 2, ACTION.WAIT, "compression", 0.48, "Small bull inside prior bear — stall, wait close"));
  }

  const tweezer = Math.abs(a.low - b.low) <= atrN * 0.12;
  if (tweezer && g.bull && g.lowerPct >= 0.4 && priorSlope(closed, 2, atrN) === "DOWN") {
    out.push(hit("tweezer_bottom", "Tweezer bottom", 2, ACTION.BUY, "reversal", 0.54, "Matching lows — double test of support"));
  }
  const tweezerHi = Math.abs(a.high - b.high) <= atrN * 0.12;
  if (tweezerHi && g.bear && g.upperPct >= 0.4 && priorSlope(closed, 2, atrN) === "UP") {
    out.push(hit("tweezer_top", "Tweezer top", 2, ACTION.SELL, "reversal", 0.54, "Matching highs — double test of resistance"));
  }

  if (q && p && q.bear && q.bodyPct >= 0.4 && q.range >= atrN * 0.65 && p.bodyPct <= 0.38 && g.bull && g.c > (q.o + q.c) / 2 && g.range >= atrN * 0.55) {
    out.push(hit("morning_star", "Morning star", 3, ACTION.BUY, "reversal", 0.66, "Bear bar, stall, bull reclaim through midpoint of first body"));
  }
  if (q && p && q.bull && q.bodyPct >= 0.4 && q.range >= atrN * 0.65 && p.bodyPct <= 0.38 && g.bear && g.c < (q.o + q.c) / 2 && g.range >= atrN * 0.55) {
    out.push(hit("evening_star", "Evening star", 3, ACTION.SELL, "reversal", 0.66, "Bull bar, stall, bear reclaim through midpoint of first body"));
  }

  if (q && p) {
    const gq = q;
    const soldiers = gq.bull && p.bull && g.bull && g.c > p.c && p.c > gq.c && g.bodyPct > 0.42 && p.bodyPct > 0.42 && gq.bodyPct > 0.42 && g.upperPct < 0.28;
    const crows = gq.bear && p.bear && g.bear && g.c < p.c && p.c < gq.c && g.bodyPct > 0.42 && p.bodyPct > 0.42 && gq.bodyPct > 0.42 && g.lowerPct < 0.28;
    if (soldiers) out.push(hit("three_soldiers", "Three white soldiers", 3, ACTION.BUY, "continuation", 0.6, "Three rising closes with real bodies — continuation, do not fade"));
    if (crows) out.push(hit("three_crows", "Three black crows", 3, ACTION.SELL, "continuation", 0.6, "Three falling closes with real bodies — continuation, do not fade"));
  }

  return out;
}

export function scoreContext(hit: CandleHit, opts: { prior: "UP" | "DOWN" | "FLAT"; regime: Regime; structure: StructureInfo; sessionActive: boolean }): number {
  let s = 0.15;
  const buy = hit.direction === ACTION.BUY;
  const sell = hit.direction === ACTION.SELL;
  if (buy && opts.structure.zone === "DISCOUNT") s += 0.32;
  else if (sell && opts.structure.zone === "PREMIUM") s += 0.32;
  else if (opts.structure.zone === "EQUILIBRIUM") s += 0.08;
  else if (buy || sell) s += 0.02;

  if (hit.role === "reversal") {
    if (buy && opts.prior === "DOWN") s += 0.28;
    else if (sell && opts.prior === "UP") s += 0.28;
    else if (opts.prior === "FLAT") s += 0.06;
    else s -= 0.12;
  }
  if (hit.role === "continuation") {
    if (buy && opts.prior === "UP") s += 0.24;
    else if (sell && opts.prior === "DOWN") s += 0.24;
    else s -= 0.08;
  }
  if (hit.role === "indecision" || hit.role === "compression") s += 0.05;

  if (buy && (opts.regime === "TREND_UP" || opts.regime === "RANGE" || opts.regime === "EXPANSION")) s += 0.12;
  if (sell && (opts.regime === "TREND_DOWN" || opts.regime === "RANGE" || opts.regime === "EXPANSION")) s += 0.12;
  if (opts.regime === "DEAD") s -= 0.2;
  if (opts.sessionActive) s += 0.08;
  if (buy || sell) {
    if (structureFits(hit.direction, opts.structure)) s += 0.1;
  }
  return clamp01(s);
}

export function scanCandles(closed: Candle[], regime: Regime, structure?: StructureInfo, sessionActive = true): CandleScan {
  if (closed.length < 8) return emptyCandleScan();
  const last = closed[closed.length - 1]!;
  const spec = assetMeta(last.asset);
  const atrN =
    atr(
      closed.map((x) => x.high),
      closed.map((x) => x.low),
      closed.map((x) => x.close),
      14,
    ) || spec.pip * 8;
  const spread = spec.typicalSpread;
  const raw = detectGeometry(closed, atrN, spread);
  const struct = structure ?? readStructure(closed);
  const scored = raw.map((h) => {
    const prior = priorSlope(closed, h.bars, atrN);
    const context = scoreContext(h, { prior, regime, structure: struct, sessionActive });
    const score = clamp01(0.55 * h.geometry + 0.45 * context);
    return { ...h, context, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const prior = priorSlope(closed, 1, atrN);
  const tradable = scored.filter((h) => h.direction !== ACTION.WAIT && h.score >= 0.56);
  const best = (tradable[0] ?? scored[0]) ?? null;
  return { hits: scored.slice(0, 6), best, priorTrend: prior, rangeAtr: atrN };
}

export function candleMaster(closed: Candle[], regime: Regime): StrategyVote {
  const name = "candle_master";
  const scan = scanCandles(closed, regime);
  const last = closed[closed.length - 1];
  if (!last) {
    return {
      name,
      direction: ACTION.WAIT,
      probability: 0.5,
      strength: 0,
      reasons: ["No bar"],
      invalidation: [],
      regimeFit: 0,
      stop: 0,
      target: 0,
    };
  }
  const best = scan.best;
  if (!best || best.direction === ACTION.WAIT || best.score < 0.58) {
    const why = best ? `${best.name}: ${best.why}` : "No closed-bar pattern with location";
    return {
      name,
      direction: ACTION.WAIT,
      probability: 0.5,
      strength: best ? best.score * 0.4 : 0,
      reasons: [why],
      invalidation: [],
      regimeFit: 0.3,
      stop: 0,
      target: 0,
    };
  }
  const a = scan.rangeAtr || 1e-6;
  const spec = assetMeta(last.asset);
  const entry = last.close;
  const pad = Math.max(a * 0.25, spec.typicalSpread * 8, spec.minStop);
  const stop = best.direction === ACTION.BUY ? Math.min(last.low, closed[closed.length - 2]?.low ?? last.low) - pad : Math.max(last.high, closed[closed.length - 2]?.high ?? last.high) + pad;
  const stopDist = Math.abs(entry - stop);
  if (stopDist < spec.minStop) {
    return {
      name,
      direction: ACTION.WAIT,
      probability: 0.5,
      strength: 0,
      reasons: ["Pattern stop inside broker minimum"],
      invalidation: [],
      regimeFit: 0.2,
      stop: 0,
      target: 0,
    };
  }
  const target = best.direction === ACTION.BUY ? entry + 1.6 * stopDist : entry - 1.6 * stopDist;
  const p = 0.52 + Math.min(0.1, (best.score - 0.58) * 0.35);
  return {
    name,
    direction: best.direction,
    probability: p,
    strength: 0.55 + best.score * 0.35,
    reasons: [`${best.name} (${best.score.toFixed(2)})`, best.why, `Prior ${scan.priorTrend}`],
    invalidation: [
      best.direction === ACTION.BUY ? "Close back below pattern low" : "Close back above pattern high",
    ],
    regimeFit: 0.7,
    stop,
    target,
  };
}
