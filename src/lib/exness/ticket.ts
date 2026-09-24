export type ExnessSymbol = "EURUSD" | "GBPUSD" | "USDJPY" | "XAUUSD";
export type AccountKind = "standard" | "raw";

export interface SymbolSpec {
  id: ExnessSymbol;
  pip: number;
  digits: number;
  contract: number;
  /** Measured Standard spread, in pips. Not a live Exness quote. */
  typicalSpreadPips: number;
  seed: number;
}

export const SYMBOLS: SymbolSpec[] = [
  { id: "EURUSD", pip: 0.0001, digits: 5, contract: 100_000, typicalSpreadPips: 0.8, seed: 1.085 },
  { id: "GBPUSD", pip: 0.0001, digits: 5, contract: 100_000, typicalSpreadPips: 1, seed: 1.27 },
  { id: "USDJPY", pip: 0.01, digits: 3, contract: 100_000, typicalSpreadPips: 1, seed: 149.5 },
  { id: "XAUUSD", pip: 0.01, digits: 3, contract: 100, typicalSpreadPips: 26, seed: 2650 },
];

export function specOf(id: ExnessSymbol) {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0]!;
}

/** USD moved by one pip, for 1.00 lot. Exness: lots × contract × pip size, JPY converted. */
export function pipValuePerLot(spec: SymbolSpec, price: number) {
  if (spec.id === "USDJPY") return price > 0 ? (spec.contract * spec.pip) / price : 0;
  return spec.contract * spec.pip;
}

export function lotsForRisk(riskUsd: number, slPips: number, spec: SymbolSpec, price: number) {
  const perLot = pipValuePerLot(spec, price);
  if (!(riskUsd > 0) || !(slPips > 0) || !(perLot > 0)) return 0;
  const raw = riskUsd / (slPips * perLot);
  return Math.floor(raw * 100) / 100;
}

export function moneyForPips(pips: number, lots: number, spec: SymbolSpec, price: number) {
  return pips * lots * pipValuePerLot(spec, price);
}

/** Raw Spread: up to 3.50 USD per lot, each side, charged when the order closes. */
export function rawCommission(lots: number, kind: AccountKind) {
  if (kind !== "raw") return 0;
  return lots * 3.5 * 2;
}

export function quoteFromMid(mid: number, spec: SymbolSpec) {
  const half = (spec.typicalSpreadPips * spec.pip) / 2;
  return { bid: mid - half, ask: mid + half, spreadPips: spec.typicalSpreadPips };
}

export function pricesFor(side: "BUY" | "SELL", bid: number, ask: number, slPips: number, tpPips: number, spec: SymbolSpec) {
  const open = side === "BUY" ? ask : bid;
  const sl = side === "BUY" ? open - slPips * spec.pip : open + slPips * spec.pip;
  const tp = side === "BUY" ? open + tpPips * spec.pip : open - tpPips * spec.pip;
  return { open, sl, tp };
}

export function levelBreak(close: number | null, level: number | null): "BUY" | "SELL" | "WAIT" {
  if (close == null || level == null || !(level > 0) || !(close > 0)) return "WAIT";
  if (close > level) return "BUY";
  if (close < level) return "SELL";
  return "WAIT";
}

export function fmt(n: number, digits: number) {
  return n.toFixed(digits);
}

export function money(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
