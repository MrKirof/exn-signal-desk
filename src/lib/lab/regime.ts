import type { Candle, Direction, Regime } from "./types.ts";
import { adx, atr, efficiencyRatio, ema, percentileRank, slope } from "./indicators.ts";
import { resample } from "./candles.ts";

export function rawRegime(closed: Candle[]): { regime: Regime; confidence: number; why: string } {
  if (closed.length < 40) return { regime: "MIXED", confidence: 0.2, why: "warmup" };
  const closes = closed.map((c) => c.close);
  const highs = closed.map((c) => c.high);
  const lows = closed.map((c) => c.low);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = closes.length > 200 ? ema(closes, 200) : e50;
  const d = adx(highs, lows, closes, 14) ?? 15;
  const a = atr(highs, lows, closes, 14) ?? 0;
  const aSlow = atr(highs.slice(0, -10), lows.slice(0, -10), closes.slice(0, -10), 14) ?? a;
  const volRatio = aSlow > 0 ? a / aSlow : 1;
  const er = efficiencyRatio(closes, 10) ?? 0;
  const eSlope = e20 != null ? slope([...(closes.slice(-8, -1).map(() => e20)), e20], 4) : 0;
  const alignedUp = e20 != null && e50 != null && e20 > e50 && (e200 == null || e50 >= e200 * 0.999);
  const alignedDn = e20 != null && e50 != null && e20 < e50 && (e200 == null || e50 <= e200 * 1.001);
  const last = closes[closes.length - 1];
  const look = closed.slice(-30);
  const hi = Math.max(...look.map((c) => c.high));
  const lo = Math.min(...look.map((c) => c.low));
  const nearBreak = last > hi - a * 0.2 || last < lo + a * 0.2;
  const atrHist: number[] = [];
  for (let i = 24; i < closed.length; i++) {
    const v = atr(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), 14);
    if (v) atrHist.push(v);
  }
  const atrPct = percentileRank(atrHist, a);
  const bodies = closed.slice(-8).map((c) => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((s, x) => s + x, 0) / Math.max(1, bodies.length);

  if (atrPct < 0.18 && avgBody < a * 0.45 && er < 0.18) {
    return { regime: "DEAD", confidence: 0.72, why: "compressed ATR, low efficiency" };
  }
  if (volRatio > 1.7 && nearBreak) {
    return { regime: "EXPANSION", confidence: 0.74, why: "ATR expansion near range edge" };
  }
  if (volRatio > 1.85 || atrPct > 0.92) {
    return { regime: "HIGH_VOLATILITY", confidence: 0.7, why: "ATR extreme" };
  }
  if (alignedUp && d >= 24 && er >= 0.32) {
    return { regime: "TREND_UP", confidence: 0.86, why: "EMA stack + ADX + ER" };
  }
  if (alignedDn && d >= 24 && er >= 0.32) {
    return { regime: "TREND_DOWN", confidence: 0.86, why: "EMA stack down + ADX + ER" };
  }
  if (alignedUp && d >= 16 && (eSlope ?? 0) >= 0) {
    return { regime: "TREND_UP", confidence: 0.62, why: "mild up stack" };
  }
  if (alignedDn && d >= 16 && (eSlope ?? 0) <= 0) {
    return { regime: "TREND_DOWN", confidence: 0.62, why: "mild down stack" };
  }
  if (d < 18 && er < 0.28) {
    return { regime: "RANGE", confidence: 0.72, why: "low ADX, low ER" };
  }
  return { regime: "MIXED", confidence: 0.4, why: "mixed structure" };
}

export function detectRegime(closed: Candle[]): { regime: Regime; confidence: number; why: string; stable: boolean } {
  const a = rawRegime(closed);
  if (closed.length < 42) return { ...a, regime: "MIXED", stable: false };
  const b = rawRegime(closed.slice(0, -1));
  if (a.regime === b.regime) {
    return { ...a, stable: a.regime !== "TRANSITION" };
  }
  return {
    regime: "TRANSITION",
    confidence: 0.35,
    why: "regime not confirmed (hysteresis)",
    stable: false,
  };
}

export function regimeFits(name: string, regime: Regime): number {
  const trend = name === "trend_pullback";
  const brk = name === "breakout_retest";
  const mr = name === "range_reversion";
  const mom = name === "controlled_momentum";
  const candle = name === "candle_master";
  if (regime === "TREND_UP" || regime === "TREND_DOWN") {
    if (trend) return 1;
    if (mom) return 0.85;
    if (candle) return 0.88;
    if (brk) return 0.45;
    if (mr) return 0.1;
  }
  if (regime === "RANGE") {
    if (mr) return 1;
    if (candle) return 0.82;
    if (brk) return 0.4;
    if (trend || mom) return 0.12;
  }
  if (regime === "EXPANSION") {
    if (brk) return 1;
    if (mom) return 0.7;
    if (candle) return 0.55;
    if (mr) return 0.08;
    return 0.35;
  }
  if (regime === "HIGH_VOLATILITY") {
    if (brk || mom) return 0.55;
    if (candle) return 0.4;
    if (mr) return 0.05;
    return 0.3;
  }
  if (regime === "DEAD") {
    if (mr) return 0.4;
    if (candle) return 0.12;
    return 0.08;
  }
  if (regime === "TRANSITION" || regime === "MIXED") return 0.2;
  return 0.35;
}

export function htfContext(closed: Candle[]): {
  bias: Direction;
  allowed: Direction | "FLAT";
  conflict: "NONE" | "LOW" | "HIGH";
  why: string;
} {
  const tf = closed[0]?.timeframe ?? "1m";
  const factor = tf === "1m" ? 15 : tf === "5m" ? 3 : 1;
  const htf = resample(closed, factor);
  if (htf.length < 24) {
    return { bias: "WAIT", allowed: "FLAT", conflict: "NONE", why: "HTF warmup" };
  }
  const closes = htf.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, Math.min(50, closes.length - 1));
  if (e20 == null || e50 == null) return { bias: "WAIT", allowed: "FLAT", conflict: "NONE", why: "HTF EMA warmup" };
  const gap = Math.abs(e20 - e50) / Math.max(e50, 1e-9);
  if (gap < 0.00035) {
    return { bias: "WAIT", allowed: "FLAT", conflict: "LOW", why: "HTF EMAs too close to veto" };
  }
  if (e20 > e50) {
    return { bias: "BUY", allowed: "BUY", conflict: "NONE", why: "HTF EMA20 > EMA50" };
  }
  if (e20 < e50) {
    return { bias: "SELL", allowed: "SELL", conflict: "NONE", why: "HTF EMA20 < EMA50" };
  }
  return { bias: "WAIT", allowed: "FLAT", conflict: "LOW", why: "HTF flat" };
}

export function htfConflict(direction: Direction, htf: ReturnType<typeof htfContext>): "NONE" | "LOW" | "HIGH" {
  if (direction === "WAIT" || htf.allowed === "FLAT") return htf.conflict;
  if (direction === htf.allowed) return "NONE";
  return "HIGH";
}
