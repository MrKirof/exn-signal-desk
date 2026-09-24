/** Layer 2 — candles and quotes. Does not decide trades. */
export { bookFromSpot, generateHistory, stepMarket } from "../market";
export type { MarketBook } from "../market";
export { candlesFromSpot } from "../feed";
export type { SpotSnapshot } from "../feed";
export { normalizeBook } from "../candles";
export { collectorToSpot, demoCollectorFromBars, newCollectorToken, parseCollector } from "../collector";
