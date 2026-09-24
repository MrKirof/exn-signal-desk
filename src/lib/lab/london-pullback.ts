import type { Candle } from "./types.ts";

const BOOK = "GBPUSD 5m, 32 trades, 14 wins. The account did not grow, so this play stays off.";

function dayKey(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

export function londonPullbackNote(closed: Candle[]): string | null {
  const last = closed[closed.length - 1];
  if (!last || last.asset !== "GBPUSD" || last.timeframe !== "5m") return null;
  const today = closed.filter((c) => dayKey(c.t) === dayKey(last.t));
  const open = today.filter((c) => {
    const d = new Date(c.t);
    return d.getUTCHours() === 7 && d.getUTCMinutes() < 30;
  });
  if (open.length < 4) return `London pullback waits for the 07:00–07:30 range. ${BOOK}`;
  const hi = Math.max(...open.map((c) => c.high));
  const lo = Math.min(...open.map((c) => c.low));
  const later = today.filter((c) => c.t > open[open.length - 1]!.t && new Date(c.t).getUTCHours() < 11);
  let side: "up" | "down" | null = null;
  let level = 0;
  let pulled = false;
  for (const bar of later) {
    if (!side) {
      if (bar.close > hi && bar.close > bar.open) {
        side = "up";
        level = hi;
      } else if (bar.close < lo && bar.close < bar.open) {
        side = "down";
        level = lo;
      }
      continue;
    }
    const back =
      side === "up"
        ? bar.low <= level && bar.close > level && bar.close > bar.open
        : bar.high >= level && bar.close < level && bar.close < bar.open;
    if (back) pulled = true;
  }
  if (pulled) return `Open-range pullback is on the chart. Not taken. ${BOOK}`;
  if (side) return `Open range broke ${side}. Waiting for the pullback. Not a trade yet. ${BOOK}`;
  return `No open-range break yet. ${BOOK}`;
}
