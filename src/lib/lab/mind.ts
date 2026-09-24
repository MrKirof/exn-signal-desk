const LOSS_COOL_MS = 3 * 60_000;
const WIN_COOL_MS = 2 * 60_000;

export function mindGate(opts: {
  open: boolean;
  outcomes: { kind: string; settledAt: number; outcomeR?: number }[];
  now?: number;
}): string | null {
  if (opts.open) return "One trade at a time. Do not add to a loser.";
  const now = opts.now ?? Date.now();
  const last = [...opts.outcomes].reverse().find((o) => o.kind === "WIN" || o.kind === "LOSS");
  if (!last) return null;
  if (last.kind === "LOSS") {
    const left = LOSS_COOL_MS - (now - last.settledAt);
    if (left > 0) return `Loss just closed. Wait ${Math.ceil(left / 1000)}s. Do not trade to get it back.`;
  }
  if (last.kind === "WIN" && (last.outcomeR ?? 0) >= 1.5) {
    const left = WIN_COOL_MS - (now - last.settledAt);
    if (left > 0) return `Big win just closed. Wait ${Math.ceil(left / 1000)}s before the next paper.`;
  }
  return null;
}

export function chaseBlock(direction: "BUY" | "SELL" | "WAIT", entry: number, price: number, atr: number): string | null {
  if (direction === "WAIT" || !(atr > 0) || !(entry > 0)) return null;
  const ran = direction === "BUY" ? price - entry : entry - price;
  if (ran > atr) return "Price already ran. Do not chase.";
  return null;
}
