import type { Direction } from "./types.ts";

export const ACTION = {
  BUY: "BUY",
  SELL: "SELL",
  WAIT: "WAIT",
} as const satisfies Record<string, Direction>;

export function isTrade(d: Direction): d is "BUY" | "SELL" {
  return d === "BUY" || d === "SELL";
}

export function signalKey(parts: {
  asset: string;
  timeframe: string;
  candleStart: number;
  strategy: string;
  direction: Direction;
}) {
  return `${parts.asset}|${parts.timeframe}|${parts.candleStart}|${parts.strategy}|${parts.direction}`;
}
