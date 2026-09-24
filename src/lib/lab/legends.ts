import type { Candle, Direction } from "./types.ts";
import { atr, ema } from "./indicators.ts";

export interface LegendVote {
  name: "Soros" | "Druckenmiller" | "Krieger" | "Lipschutz" | "Kovner";
  direction: Direction;
  stop: number;
  target: number;
  why: string;
}

export const PLAYBOOK = [
  "Soros: a break is real only if the next closes stay beyond it, and the gain is at least twice the loss if it fails.",
  "Druckenmiller: the short swing and the longer swing must agree. A rate shock cancels the trade. Never trade the present against the bigger move.",
  "Krieger: only a fast stretch, three times a normal candle in eight candles, that then turns. His famous trade was selling that stretch. Size stays small.",
  "Lipschutz: one-way tape, exit known before entry, and after a loss the next stake is cut in half.",
  "Kovner: take the break only when the exit is close enough to understand. Risk stays near one percent, not five.",
] as const;

function none(name: LegendVote["name"], why: string): LegendVote {
  return { name, direction: "WAIT", stop: 0, target: 0, why };
}

function barAtr(closed: Candle[]) {
  const closes = closed.map((c) => c.close);
  return atr(closed.map((c) => c.high), closed.map((c) => c.low), closes, 14) ?? 0;
}

function withPayoff(name: LegendVote["name"], direction: "BUY" | "SELL", entry: number, stop: number, why: string): LegendVote {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return none(name, "No invalidation, so no trade");
  const target = direction === "BUY" ? entry + risk * 2 : entry - risk * 2;
  const sane = direction === "BUY" ? stop < entry && target > entry : stop > entry && target < entry;
  if (!sane) return none(name, "Exit is on the wrong side");
  return { name, direction, stop, target, why };
}

export function sorosVote(closed: Candle[]): LegendVote {
  if (closed.length < 24) return none("Soros", "Not enough tape");
  const a = barAtr(closed);
  const prior = closed.slice(-23, -3);
  const held = closed.slice(-3);
  const hi = Math.max(...prior.map((c) => c.high));
  const lo = Math.min(...prior.map((c) => c.low));
  const last = held[held.length - 1]!;
  const wide = last.high - last.low > Math.max(a, 1e-9) * 0.8;
  if (wide && held.every((c) => c.close > hi)) {
    return withPayoff("Soros", "BUY", last.close, hi, "Break held for three closes. Loss if it falls back through the old high is half the target.");
  }
  if (wide && held.every((c) => c.close < lo)) {
    return withPayoff("Soros", "SELL", last.close, lo, "Breakdown held for three closes. Loss if it reclaims the old low is half the target.");
  }
  return none("Soros", "No break that held");
}

export function druckenmillerVote(closed: Candle[], rateShock: boolean): LegendVote {
  if (rateShock) return none("Druckenmiller", "A rate shock is in the feed. He does not trade the present through that.");
  if (closed.length < 50) return none("Druckenmiller", "The bigger move is not visible yet");
  const a = Math.max(barAtr(closed), 1e-9);
  const closes = closed.map((c) => c.close);
  const now = closes[closes.length - 1]!;
  const near = now - closes[closes.length - 20]!;
  const big = now - closes[closes.length - 50]!;
  if (Math.abs(big) < a) return none("Druckenmiller", "The bigger move is too small");
  if (near > 0 && big > 0) {
    const stop = Math.min(...closed.slice(-20).map((c) => c.low));
    return withPayoff("Druckenmiller", "BUY", now, stop, "Short swing and longer swing both rise");
  }
  if (near < 0 && big < 0) {
    const stop = Math.max(...closed.slice(-20).map((c) => c.high));
    return withPayoff("Druckenmiller", "SELL", now, stop, "Short swing and longer swing both fall");
  }
  return none("Druckenmiller", "The present fights the bigger move");
}

export function kriegerVote(closed: Candle[]): LegendVote {
  if (closed.length < 20) return none("Krieger", "Need the last eight candles");
  const a = Math.max(barAtr(closed), 1e-9);
  const tail = closed.slice(-8);
  const first = tail[0]!.open;
  const last = tail[tail.length - 1]!;
  const move = last.close - first;
  const range = Math.max(last.high - last.low, 1e-12);
  const upper = (last.high - Math.max(last.open, last.close)) / range;
  const lower = (Math.min(last.open, last.close) - last.low) / range;
  if (move > 3 * a && last.close < last.open && upper >= 0.35) {
    const stop = Math.max(...tail.map((c) => c.high));
    return withPayoff("Krieger", "SELL", last.close, stop, "Eight candles ran more than three normal candles and the last one turned down");
  }
  if (move < -3 * a && last.close > last.open && lower >= 0.35) {
    const stop = Math.min(...tail.map((c) => c.low));
    return withPayoff("Krieger", "BUY", last.close, stop, "Eight candles fell more than three normal candles and the last one turned up");
  }
  return none("Krieger", "No fast stretch");
}

export function lipschutzVote(closed: Candle[], sessionActive: boolean): LegendVote {
  if (!sessionActive) return none("Lipschutz", "Dead session. No flow.");
  if (closed.length < 10) return none("Lipschutz", "Tape is too short");
  const a = Math.max(barAtr(closed), 1e-9);
  const tail = closed.slice(-8);
  let flips = 0;
  for (let i = 2; i < tail.length; i++) {
    const prev = tail[i]!.close - tail[i - 1]!.close;
    const before = tail[i - 1]!.close - tail[i - 2]!.close;
    if (prev * before < 0) flips += 1;
  }
  if (flips >= 2) return none("Lipschutz", "The tape flipped. Stand aside.");
  const last = tail[tail.length - 1]!;
  const net = last.close - tail[0]!.open;
  if (net > a) {
    const stop = Math.min(...tail.map((c) => c.low));
    if (last.close - stop > 1.5 * a) return none("Lipschutz", "The exit is too far to know the risk now");
    return withPayoff("Lipschutz", "BUY", last.close, stop, "One-way tape. Exit is the low of this push.");
  }
  if (net < -a) {
    const stop = Math.max(...tail.map((c) => c.high));
    if (stop - last.close > 1.5 * a) return none("Lipschutz", "The exit is too far to know the risk now");
    return withPayoff("Lipschutz", "SELL", last.close, stop, "One-way tape. Exit is the high of this push.");
  }
  return none("Lipschutz", "No clean flow");
}

export function kovnerVote(closed: Candle[]): LegendVote {
  if (closed.length < 25) return none("Kovner", "No clear invalidation yet");
  const closes = closed.map((c) => c.close);
  const mean = ema(closes, 20);
  const a = Math.max(barAtr(closed), 1e-9);
  const last = closed[closed.length - 1]!;
  const prior = closed.slice(-11, -1);
  if (mean == null) return none("Kovner", "Average not ready");
  const hi = Math.max(...prior.map((c) => c.high));
  const lo = Math.min(...prior.map((c) => c.low));
  if (last.close > mean && last.close > hi) {
    const risk = last.close - lo;
    if (risk < 0.4 * a || risk > 1.5 * a) return none("Kovner", "The exit is not a size he would understand");
    return withPayoff("Kovner", "BUY", last.close, lo, "Above the average and through the old high. Exit is that old low.");
  }
  if (last.close < mean && last.close < lo) {
    const risk = hi - last.close;
    if (risk < 0.4 * a || risk > 1.5 * a) return none("Kovner", "The exit is not a size he would understand");
    return withPayoff("Kovner", "SELL", last.close, hi, "Under the average and through the old low. Exit is that old high.");
  }
  return none("Kovner", "No break with a nearby exit");
}

export function legendCouncil(closed: Candle[], sessionActive: boolean, rateShock = false) {
  const votes = [
    sorosVote(closed),
    druckenmillerVote(closed, rateShock),
    kriegerVote(closed),
    lipschutzVote(closed, sessionActive),
    kovnerVote(closed),
  ];
  const buys = votes.filter((v) => v.direction === "BUY");
  const sells = votes.filter((v) => v.direction === "SELL");
  const side: Direction = buys.length >= 3 && sells.length === 0 ? "BUY" : sells.length >= 3 && buys.length === 0 ? "SELL" : "WAIT";
  const pack = side === "BUY" ? buys : side === "SELL" ? sells : [];
  const stop = pack.length ? pack.reduce((s, v) => s + v.stop, 0) / pack.length : 0;
  const target = pack.length ? pack.reduce((s, v) => s + v.target, 0) / pack.length : 0;
  const line = votes.map((v) => `${v.name} ${v.direction}`).join(" · ");
  return { votes, direction: side, stop, target, line, agrees: pack.length };
}
