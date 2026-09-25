/** A live quote can tick many times inside one candle. The call stays put until that candle closes. */
export function shouldReplaceSignal(opts: {
  mode: string;
  open: boolean;
  hasSignal: boolean;
  barDue: boolean;
  closedBarT: number;
  heldBarT: number;
}): boolean {
  if (opts.open || !opts.hasSignal) return true;
  if (opts.mode === "simulated") return true;
  if (opts.barDue) return true;
  if (!(opts.heldBarT > 0)) return true;
  return opts.closedBarT !== opts.heldBarT;
}
