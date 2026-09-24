import type { Direction, Outcome, OutcomeKind, Signal } from "./types.ts";
import { ACTION, isTrade } from "./actions.ts";

export interface PathBar {
  t: number;
  high: number;
  low: number;
  close: number;
}

export function settlePath(opts: {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  bars: PathBar[];
  timeout?: boolean;
}): { kind: OutcomeKind; exit: number; outcomeR: number; ambiguous: boolean; barsHeld: number } {
  const { direction, entry, stop, target, bars } = opts;
  const stopDist = Math.abs(entry - stop);
  if (!isTrade(direction) || stopDist <= 0 || !bars.length) {
    return { kind: "TIE", exit: entry, outcomeR: 0, ambiguous: false, barsHeld: 0 };
  }
  const buy = direction === ACTION.BUY;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const hitStop = buy ? b.low <= stop : b.high >= stop;
    const hitTgt = buy ? b.high >= target : b.low <= target;
    if (hitStop && hitTgt) {
      return { kind: "LOSS", exit: stop, outcomeR: -1, ambiguous: true, barsHeld: i + 1 };
    }
    if (hitStop) {
      return { kind: "LOSS", exit: stop, outcomeR: -1, ambiguous: false, barsHeld: i + 1 };
    }
    if (hitTgt) {
      const winR = Math.abs(target - entry) / stopDist;
      return { kind: "WIN", exit: target, outcomeR: winR, ambiguous: false, barsHeld: i + 1 };
    }
  }
  if (!opts.timeout) {
    return { kind: "TIE", exit: bars[bars.length - 1]!.close, outcomeR: 0, ambiguous: false, barsHeld: bars.length };
  }
  const last = bars[bars.length - 1]!;
  const move = buy ? last.close - entry : entry - last.close;
  const r = move / stopDist;
  const kind: OutcomeKind = Math.abs(r) < 0.05 ? "TIE" : r > 0 ? "WIN" : "LOSS";
  return { kind, exit: last.close, outcomeR: r, ambiguous: false, barsHeld: bars.length };
}

export function pnlFor(kind: OutcomeKind, stake: number, outcomeR: number) {
  if (kind === "TIE") return 0;
  return stake * outcomeR;
}

export function settleSignal(
  signal: Signal,
  result: ReturnType<typeof settlePath>,
  stake: number,
  opts?: { automatic?: boolean; latencyMs?: number; source?: Outcome["settlementSource"]; settledAt?: number },
): Outcome {
  const top = signal.strategies
    .filter((s) => s.direction === signal.direction)
    .sort((a, b) => b.strength - a.strength)[0];
  return {
    predictionId: signal.predictionId,
    entryPrice: signal.entryPrice,
    exitPrice: result.exit,
    kind: result.kind,
    grossProfit: pnlFor(result.kind, stake, result.outcomeR),
    stake,
    outcomeR: result.outcomeR,
    latencyMs: opts?.latencyMs ?? 0,
    automatic: opts?.automatic ?? true,
    settlementSource: opts?.source ?? "engine",
    settledAt: opts?.settledAt ?? Date.now(),
    asset: signal.asset,
    direction: signal.direction,
    calibratedProbability: signal.calibratedProbability,
    regime: signal.regime,
    strategy: top?.name ?? "meta",
    ambiguousPath: result.ambiguous,
  };
}
