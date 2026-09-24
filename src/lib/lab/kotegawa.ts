import type { Candle, Direction, Regime, StrategyVote } from "./types.ts";
import { ACTION } from "./actions.ts";
import { atr, sma } from "./indicators.ts";

function vote(
  direction: Direction,
  probability: number,
  reasons: string[],
  invalidation: string[],
  stop: number,
  target: number,
): StrategyVote {
  return {
    name: "kotegawa",
    direction,
    probability,
    strength: direction === ACTION.WAIT ? 0 : 1,
    reasons,
    invalidation,
    regimeFit: 1,
    stop,
    target,
  };
}

function wait(why: string): StrategyVote {
  return vote(ACTION.WAIT, 0.5, [why], [], 0, 0);
}

function kairi(closes: number[], index: number): number | null {
  if (index < 24) return null;
  const mean = sma(closes.slice(index - 24, index + 1), 25);
  const px = closes[index];
  if (mean == null || mean === 0 || px == null) return null;
  return (px - mean) / mean;
}

function rejection(c: Candle, side: "BUY" | "SELL") {
  const range = Math.max(c.high - c.low, 1e-12);
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  if (side === "BUY") return c.close > c.open && lower / range >= 0.35;
  return c.close < c.open && upper / range >= 0.35;
}

export function kotegawaTheory(closed: Candle[], _regime: Regime): StrategyVote {
  if (closed.length < 40) return wait("Kotegawa needs 40 closed candles");
  const closes = closed.map((c) => c.close);
  const last = closed[closed.length - 1]!;
  const mean = sma(closes, 25);
  const a = atr(closed.map((c) => c.high), closed.map((c) => c.low), closes, 14);
  const range = a ?? 0;
  if (mean == null || !(range > 0)) return wait("Kotegawa average not ready");
  const gap = last.close - mean;
  const nowK = gap / mean;
  const history: number[] = [];
  for (let i = 24; i < closes.length; i++) {
    const k = kairi(closes, i);
    if (k != null) history.push(k);
  }
  const rank = history.length ? history.filter((k) => k <= nowK).length / history.length : 0.5;
  const vols = closed.map((c) => c.volume ?? 0);
  const volSum = vols.reduce((s, v) => s + v, 0);
  const volAvg = vols.slice(-11, -1).reduce((s, v) => s + v, 0) / 10;
  const panic = volSum === 0 || (vols.at(-1) ?? 0) >= volAvg;

  if (gap < -1.2 * range && rank <= 0.2) {
    if (!rejection(last, "BUY")) return wait("Price is stretched under the 25-bar average, but buyers have not shown up");
    if (!panic) return wait("The drop has no extra volume");
    return vote(
      "BUY",
      0.58,
      [`Kotegawa buy. Price is ${((gap / mean) * 100).toFixed(2)}% under the 25-bar average and turning.`],
      ["If price breaks the low, the drop is real damage, not a stretch"],
      last.low,
      mean,
    );
  }
  if (gap > 1.5 * range && rank >= 0.85) {
    if (!rejection(last, "SELL")) return wait("Price is stretched over the 25-bar average, but sellers have not shown up");
    if (!panic) return wait("The rally has no extra volume");
    return vote(
      "SELL",
      0.56,
      [`Kotegawa sell. Price is ${((gap / mean) * 100).toFixed(2)}% over the 25-bar average and turning.`],
      ["If price breaks the high, the rally is real, not a stretch"],
      last.high,
      mean,
    );
  }
  return wait("No Kotegawa stretch. He only traded abnormal moves.");
}
