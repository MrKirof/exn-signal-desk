import type { Candle, Direction, Regime, StrategyVote } from "./types.ts";
import { atr, ema, rsi } from "./indicators.ts";
import { regimeFits } from "./regime.ts";
import { ACTION, isTrade } from "./actions.ts";
import { assetMeta } from "./constants.ts";
import { candleMaster } from "./candles-master.ts";

function vote(
  name: string,
  direction: Direction,
  probability: number,
  strength: number,
  reasons: string[],
  invalidation: string[],
  regime: Regime,
  stop: number,
  target: number,
): StrategyVote {
  return {
    name,
    direction,
    probability: Math.max(0.48, Math.min(0.7, probability)),
    strength,
    reasons,
    invalidation,
    regimeFit: regimeFits(name, regime),
    stop,
    target,
  };
}

function wait(name: string, why: string, regime: Regime): StrategyVote {
  return vote(name, ACTION.WAIT, 0.5, 0, [why], [], regime, 0, 0);
}

function swingLow(closed: Candle[], n = 8) {
  return Math.min(...closed.slice(-n).map((c) => c.low));
}

function swingHigh(closed: Candle[], n = 8) {
  return Math.max(...closed.slice(-n).map((c) => c.high));
}

function plan(
  direction: Direction,
  entry: number,
  stop: number,
  target: number,
  minStop: number,
  typicalSpread: number,
): { stop: number; target: number; rr: number } | null {
  const minDist = Math.max(minStop, typicalSpread * 10);
  let stopPx = stop;
  let stopDist = Math.abs(entry - stopPx);
  if (stopDist < minDist) {
    stopPx = direction === "BUY" ? entry - minDist : entry + minDist;
    stopDist = minDist;
  }
  let tgt = target;
  let tgtDist = Math.abs(tgt - entry);
  if (tgtDist / stopDist < 1.2) {
    tgt = direction === "BUY" ? entry + 1.5 * stopDist : entry - 1.5 * stopDist;
    tgtDist = 1.5 * stopDist;
  }
  const sideOk = direction === "BUY" ? tgt > entry && stopPx < entry : tgt < entry && stopPx > entry;
  if (!sideOk) return null;
  return { stop: stopPx, target: tgt, rr: tgtDist / stopDist };
}

export function trendPullback(closed: Candle[], regime: Regime): StrategyVote {
  const name = "trend_pullback";
  if (regime !== "TREND_UP" && regime !== "TREND_DOWN") return wait(name, "Not a confirmed trend", regime);
  const closes = closed.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const c = closed[closed.length - 1];
  if (!e20 || !e50 || !c) return wait(name, "EMA warmup", regime);
  const a = atr(closed.map((x) => x.high), closed.map((x) => x.low), closes, 14) || 1e-6;
  const r = rsi(closes, 14) ?? 50;
  const spec = assetMeta(c.asset);
  const prev = closed[closed.length - 2];

  if (regime === "TREND_UP" && e20 > e50) {
    const recent = closed.slice(-4);
    const pulled = recent.some((x) => x.low <= e20 + a * 0.35);
    const held = c.close >= e20 - a * 0.12;
    const notExt = (c.close - e20) / a <= 1.4;
    const rsiOk = r >= 38 && r <= 68;
    const trigger = c.close >= c.open || (prev != null && c.close >= prev.close);
    if (pulled && held && notExt && rsiOk && trigger) {
      const stopRaw = Math.min(swingLow(closed, 8), c.low) - a * 0.25;
      const tgtRaw = c.close + Math.max(1.6 * (c.close - stopRaw), swingHigh(closed, 24) - c.close);
      const p = plan("BUY", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
      if (!p) return wait(name, "Stop too tight", regime);
      return vote(name, ACTION.BUY, 0.6, 0.82, ["EMA trend up", "Pullback held EMA20", "Bullish hold"], ["Close back below EMA50"], regime, p.stop, p.target);
    }
  }
  if (regime === "TREND_DOWN" && e20 < e50) {
    const recent = closed.slice(-4);
    const pulled = recent.some((x) => x.high >= e20 - a * 0.35);
    const held = c.close <= e20 + a * 0.12;
    const notExt = (e20 - c.close) / a <= 1.4;
    const rsiOk = r <= 62 && r >= 32;
    const trigger = c.close <= c.open || (prev != null && c.close <= prev.close);
    if (pulled && held && notExt && rsiOk && trigger) {
      const stopRaw = Math.max(swingHigh(closed, 8), c.high) + a * 0.25;
      const tgtRaw = c.close - Math.max(1.6 * (stopRaw - c.close), c.close - swingLow(closed, 24));
      const p = plan("SELL", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
      if (!p) return wait(name, "Stop too tight", regime);
      return vote(name, ACTION.SELL, 0.6, 0.82, ["EMA trend down", "Pullback rejected EMA20", "Bearish hold"], ["Close back above EMA50"], regime, p.stop, p.target);
    }
  }
  return wait(name, "No pullback into EMA", regime);
}

export function breakoutRetest(closed: Candle[], regime: Regime): StrategyVote {
  const name = "breakout_retest";
  if (regime === "DEAD" || regime === "TRANSITION") return wait(name, "Unstable or dead tape", regime);
  const look = closed.slice(-28, -3);
  if (look.length < 12) return wait(name, "Need a stable range", regime);
  const c = closed[closed.length - 1]!;
  const retest = closed[closed.length - 2];
  const brk = closed[closed.length - 3];
  if (!retest || !brk) return wait(name, "Need retest bars", regime);
  const hi = Math.max(...look.map((x) => x.high));
  const lo = Math.min(...look.map((x) => x.low));
  const width = hi - lo;
  const closes = closed.map((x) => x.close);
  const a = atr(closed.map((x) => x.high), closed.map((x) => x.low), closes, 14) || width;
  if (width < a * 1.2 || width > a * 8) return wait(name, "Range width not tradable", regime);
  const spec = assetMeta(c.asset);
  const giant = Math.abs(brk.close - brk.open) > a * 2.6;
  if (giant) return wait(name, "Giant candle — no chase", regime);

  const brokeUp = brk.close > hi && retest.low <= hi + a * 0.15 && retest.low >= hi - a * 0.45 && c.close > hi && c.close > c.open;
  if (brokeUp) {
    const stopRaw = Math.min(retest.low, swingLow(closed.slice(-6), 6)) - a * 0.2;
    const nextRes = Math.max(...closed.slice(-60).map((x) => x.high));
    const tgtRaw = c.close + Math.max(1.5 * (c.close - stopRaw), Math.max(a * 1.8, nextRes - c.close));
    const p = plan("BUY", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.BUY, 0.59, 0.78, ["Range high broken", "Retest held", "Close back above"], ["Close back inside range"], regime, p.stop, p.target);
  }
  const brokeDn = brk.close < lo && retest.high >= lo - a * 0.15 && retest.high <= lo + a * 0.45 && c.close < lo && c.close < c.open;
  if (brokeDn) {
    const stopRaw = Math.max(retest.high, swingHigh(closed.slice(-6), 6)) + a * 0.2;
    const tgtRaw = c.close - Math.max(1.5 * (stopRaw - c.close), a * 1.8);
    const p = plan("SELL", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.SELL, 0.59, 0.78, ["Range low broken", "Retest held", "Close back below"], ["Close back inside range"], regime, p.stop, p.target);
  }
  return wait(name, "No breakout + retest", regime);
}

export function rangeReversion(closed: Candle[], regime: Regime): StrategyVote {
  const name = "range_reversion";
  if (regime !== "RANGE" && regime !== "DEAD") return wait(name, "Not a range regime", regime);
  const look = closed.slice(-36);
  const c = closed[closed.length - 1]!;
  const hi = Math.max(...look.map((x) => x.high));
  const lo = Math.min(...look.map((x) => x.low));
  const span = Math.max(hi - lo, 1e-12);
  const mid = (hi + lo) / 2;
  const loc = (c.close - lo) / span;
  const range = Math.max(c.high - c.low, 1e-12);
  const closes = closed.map((x) => x.close);
  const a = atr(closed.map((x) => x.high), closed.map((x) => x.low), closes, 14) || span / 8;
  const r = rsi(closes, 14) ?? 50;
  const spec = assetMeta(c.asset);
  const wickLow = (Math.min(c.open, c.close) - c.low) / range;
  const wickHi = (c.high - Math.max(c.open, c.close)) / range;
  const touchesLo = look.filter((x) => x.low <= lo + span * 0.08).length;
  const touchesHi = look.filter((x) => x.high >= hi - span * 0.08).length;

  if (loc <= 0.16 && c.close > c.open && wickLow > 0.28 && r < 42 && touchesLo >= 2 && c.close > lo) {
    const stopRaw = lo - a * 0.25;
    const tgtRaw = Math.min(mid, c.close + 1.6 * (c.close - stopRaw));
    const p = plan("BUY", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.BUY, 0.58, 0.74, ["Range support respected", "Rejection at lower edge", "Target at midpoint"], ["Close below range low"], regime, p.stop, p.target);
  }
  if (loc >= 0.84 && c.close < c.open && wickHi > 0.28 && r > 58 && touchesHi >= 2 && c.close < hi) {
    const stopRaw = hi + a * 0.25;
    const tgtRaw = Math.max(mid, c.close - 1.6 * (stopRaw - c.close));
    const p = plan("SELL", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.SELL, 0.58, 0.74, ["Range resistance respected", "Rejection at upper edge", "Target at midpoint"], ["Close above range high"], regime, p.stop, p.target);
  }
  return wait(name, "Not at a respected range edge", regime);
}

export function controlledMomentum(closed: Candle[], regime: Regime): StrategyVote {
  const name = "controlled_momentum";
  if (regime === "RANGE" || regime === "DEAD" || regime === "TRANSITION") {
    return wait(name, "Momentum not used in range/transition", regime);
  }
  const c = closed[closed.length - 1]!;
  const last3 = closed.slice(-3);
  if (last3.length < 3) return wait(name, "Need impulse bars", regime);
  const closes = closed.map((x) => x.close);
  const a = atr(closed.map((x) => x.high), closed.map((x) => x.low), closes, 14) || 1e-6;
  const e21 = ema(closes, 21);
  if (!e21) return wait(name, "warmup", regime);
  const spec = assetMeta(c.asset);
  const net = last3[2]!.close - last3[0]!.open;
  const range = Math.max(c.high - c.low, 1e-12);
  const closeLoc = (c.close - c.low) / range;
  const expansion = range / a;
  const sameUp = last3.every((x) => x.close > x.open);
  const sameDn = last3.every((x) => x.close < x.open);
  if (sameUp && expansion < 1.05) return wait(name, "Three up bars without expansion is not momentum", regime);
  if (sameDn && expansion < 1.05) return wait(name, "Three down bars without expansion is not momentum", regime);

  const distEma = Math.abs(c.close - e21) / a;
  if (distEma > 2.2) return wait(name, "Move already extended", regime);

  if (net > a * 1.15 && closeLoc > 0.65 && c.close > e21 && expansion >= 1.15 && distEma <= 2.2) {
    const stopRaw = swingLow(closed, 4) - a * 0.2;
    const tgtRaw = c.close + 1.55 * (c.close - stopRaw);
    const p = plan("BUY", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.BUY, 0.57, 0.7, ["Volatility expansion", "Close in upper third", "Trend aligned, not extended"], ["Close back through EMA21"], regime, p.stop, p.target);
  }
  if (net < -a * 1.15 && closeLoc < 0.35 && c.close < e21 && expansion >= 1.15 && distEma <= 2.2) {
    const stopRaw = swingHigh(closed, 4) + a * 0.2;
    const tgtRaw = c.close - 1.55 * (stopRaw - c.close);
    const p = plan("SELL", c.close, stopRaw, tgtRaw, spec.minStop, spec.typicalSpread);
    if (!p) return wait(name, "Stop too tight", regime);
    return vote(name, ACTION.SELL, 0.57, 0.7, ["Volatility expansion down", "Close in lower third", "Trend aligned, not extended"], ["Close back through EMA21"], regime, p.stop, p.target);
  }
  return wait(name, "No controlled impulse", regime);
}

export const STRATEGY_FNS = [trendPullback, breakoutRetest, rangeReversion, controlledMomentum, candleMaster];

export function runStrategies(closed: Candle[], regime: Regime): StrategyVote[] {
  return STRATEGY_FNS.map((fn) => fn(closed, regime));
}

export function confirmLive(
  direction: Direction,
  forming: Candle | null,
  closed: Candle[],
): { direction: Direction; status: "confirm" | "cancel" | "hold" | "none"; why: string } {
  if (!forming || !isTrade(direction)) return { direction, status: "none", why: "" };
  const closes = closed.map((c) => c.close);
  const a = atr(closed.map((c) => c.high), closed.map((c) => c.low), closes, 14) || Math.abs(forming.close) * 0.0004;
  const body = forming.close - forming.open;
  const range = Math.max(forming.high - forming.low, 1e-12);
  const against =
    (direction === ACTION.BUY && body < -a * 0.35) || (direction === ACTION.SELL && body > a * 0.35);
  const engulf =
    (direction === ACTION.BUY && body < 0 && Math.abs(body) / range > 0.62) ||
    (direction === ACTION.SELL && body > 0 && Math.abs(body) / range > 0.62);
  if (against || engulf) return { direction: ACTION.WAIT, status: "cancel", why: "Live candle ran against signal" };
  const withDir = (direction === ACTION.BUY && body > 0) || (direction === ACTION.SELL && body < 0);
  if (withDir) return { direction, status: "confirm", why: "Live candle agrees" };
  return { direction, status: "hold", why: "Live candle still forming" };
}
