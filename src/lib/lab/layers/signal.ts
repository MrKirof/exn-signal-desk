/** Layer 3 — scan and signal. Reads candles, does not place a ticket. */
export { analyze, emptyModel, similarWinRate } from "../pipeline";
export { atr } from "../indicators";
export { projectOutlook } from "../outlook";
export type { MarketOutlook } from "../outlook";
export { PLAYBOOK } from "../legends";
export { backtest } from "../backtest";
export type { MarketMood } from "../scan";
