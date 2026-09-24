/** Closed-bar clock. A signal may not use a candle that has not started yet. */

export function clockBreach(candleStart: number, now: number): string | null {
  if (!Number.isFinite(candleStart) || !Number.isFinite(now)) return "WAIT — bar clock is missing";
  if (candleStart > now + 1_000) return "WAIT — bar time is ahead of the clock";
  return null;
}
