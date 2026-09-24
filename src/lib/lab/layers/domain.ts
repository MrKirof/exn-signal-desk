/** Layer 1 — names, settings, and trade actions. No network, no clock. */
export { ACTION, isTrade } from "../actions";
export { ASSETS, DEFAULT_SETTINGS, MAX_HOLD_BARS, MODEL_VERSION, TIMEFRAME_SEC, assetMeta } from "../constants";
export { mulberry32 } from "../rng";
export type {
  AssetId,
  BacktestReport,
  Candle,
  Direction,
  HealthState,
  IntegrityReport,
  LabSettings,
  Lifecycle,
  ModelRecord,
  NewsEvent,
  Outcome,
  Regime,
  RiskState,
  Signal,
  Timeframe,
  ViewId,
} from "../types";
