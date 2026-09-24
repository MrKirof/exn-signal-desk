import type { Candle, Direction } from "./types.ts";
import { ACTION } from "./actions.ts";

const RR = 1.5;

export interface MyPlay {
  direction: Direction;
  stop: number;
  target: number;
  note: string;
}

function dayKey(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

/** One market, one session. London open-range break, then the first pullback. */
export function myPlay(closed: Candle[], spread: number): MyPlay {
  const last = closed[closed.length - 1];
  const wait = (note: string): MyPlay => ({ direction: ACTION.WAIT, stop: 0, target: 0, note });
  if (!last) return wait("No candle.");
  if (last.asset !== "GBPUSD" || last.timeframe !== "5m") {
    return wait("This play is only GBPUSD 5m.");
  }
  const today = closed.filter((c) => dayKey(c.t) === dayKey(last.t));
  const open = today.filter((c) => {
    const d = new Date(c.t);
    return d.getUTCHours() === 7 && d.getUTCMinutes() < 30;
  });
  if (open.length < 4) return wait("London open range is not finished (07:00–07:30 UTC).");
  const hi = Math.max(...open.map((c) => c.high));
  const lo = Math.min(...open.map((c) => c.low));
  const span = hi - lo;
  if (!(span > 0)) return wait("Open range is empty.");
  const later = today.filter((c) => c.t > open[open.length - 1]!.t && new Date(c.t).getUTCHours() < 11);
  let side: 1 | -1 | 0 = 0;
  let level = 0;
  let pullback: Candle | null = null;
  for (const bar of later) {
    if (!side) {
      if (bar.close > hi && bar.close > bar.open) {
        side = 1;
        level = hi;
      } else if (bar.close < lo && bar.close < bar.open) {
        side = -1;
        level = lo;
      }
      continue;
    }
    if (pullback) break;
    const back =
      side === 1
        ? bar.low <= level && bar.close > level && bar.close > bar.open
        : bar.high >= level && bar.close < level && bar.close < bar.open;
    if (back) pullback = bar;
  }
  if (!side) return wait("No close outside the London open range yet.");
  if (!pullback) return wait(`Range broke ${side === 1 ? "up" : "down"}. Waiting for the first pullback.`);
  if (pullback.t !== last.t) return wait("Pullback already printed. One trade a day, and this bar is not it.");
  const stop = side === 1 ? pullback.low - span * 0.05 : pullback.high + span * 0.05;
  const entry = side === 1 ? last.close + spread : last.close - spread;
  const risk = Math.abs(entry - stop);
  if (!(risk > spread * 8)) return wait("Stop is too close to the spread. No trade.");
  const target = entry + side * RR * risk;
  return {
    direction: side === 1 ? ACTION.BUY : ACTION.SELL,
    stop,
    target,
    note: side === 1 ? "Buy the first pullback after the range breaks up." : "Sell the first pullback after the range breaks down.",
  };
}
