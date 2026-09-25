import type { AssetId, LabSettings, Timeframe } from "./types.ts";

export const APP_NAME = "EXN Signal Lab";
export const APP_VERSION = "4.2.6";
export const MODEL_VERSION = "exn-lab-2.3.0";
export const FEATURE_VERSION = "f-1.1.0";
export const STRATEGY_VERSION = "s-2.1.0";

export const DEFAULT_PAYOUT = 0.85; // collector/compat only — not CFD EV
export const MIN_EV_R = 0.1;
export const MIN_EV = MIN_EV_R;
export const SAFETY_MARGIN = 0.03;
export const MIN_SAMPLE = 30;
export const HARD_STAKE_CEILING = 0.01;
export const DEFAULT_STAKE_FRAC = 0.0025;
export const MAX_STAKE_FRAC = 0.005;
export const KELLY_FRACTION = 0.25;
export const MAX_MARTINGALE_STEP = 3;
export const SIGNAL_TTL_MS = 5 * 60_000;
export const WARMUP_BARS = 60;
export const RETENTION_CANDLES = 8000;
export const DB_NAME = "exn-signal-lab";
export const DB_VERSION = 2;
export const DATA_QUALITY_MIN = 0.9;
export const MAX_HOLD_BARS = 24;

export const TIMEFRAME_SEC: Record<Timeframe, number> = {
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
};

export interface SymbolSpec {
  id: AssetId;
  label: string;
  yahoo: string;
  kraken: string;
  coinbase: string | null;
  digits: number;
  pip: number;
  start: number;
  vol: number;
  currencies: string[];
  typicalSpread: number;
  minStop: number;
  minLot: number;
  lotStep: number;
  valuePerPrice: number;
  contractSize: number;
  usdNotional: "quote" | "base";
}

export const ASSETS: SymbolSpec[] = [
  { id: "EURUSD", label: "EUR/USD", yahoo: "EURUSD=X", kraken: "EURUSD", coinbase: null, digits: 5, pip: 0.0001, start: 1.1458, vol: 0.00018, currencies: ["EUR", "USD"], typicalSpread: 0.00012, minStop: 0.0003, minLot: 0.01, lotStep: 0.01, valuePerPrice: 100_000, contractSize: 100_000, usdNotional: "quote" },
  { id: "GBPUSD", label: "GBP/USD", yahoo: "GBPUSD=X", kraken: "GBPUSD", coinbase: null, digits: 5, pip: 0.0001, start: 1.3362, vol: 0.00022, currencies: ["GBP", "USD"], typicalSpread: 0.00016, minStop: 0.0004, minLot: 0.01, lotStep: 0.01, valuePerPrice: 100_000, contractSize: 100_000, usdNotional: "quote" },
  { id: "USDJPY", label: "USD/JPY", yahoo: "USDJPY=X", kraken: "USDJPY", coinbase: null, digits: 3, pip: 0.01, start: 157.71, vol: 0.00016, currencies: ["USD", "JPY"], typicalSpread: 0.012, minStop: 0.03, minLot: 0.01, lotStep: 0.01, valuePerPrice: 1000, contractSize: 100_000, usdNotional: "base" },
  { id: "XAUUSD", label: "XAU/USD", yahoo: "GC=F", kraken: "PAXGUSD", coinbase: null, digits: 2, pip: 0.1, start: 4311.1, vol: 0.00042, currencies: ["XAU", "USD"], typicalSpread: 0.28, minStop: 0.5, minLot: 0.01, lotStep: 0.01, valuePerPrice: 100, contractSize: 100, usdNotional: "quote" },
  { id: "BTCUSD", label: "BTC/USD", yahoo: "BTC-USD", kraken: "XBTUSD", coinbase: "BTC-USD", digits: 1, pip: 1, start: 85270, vol: 0.0011, currencies: ["BTC", "USD"], typicalSpread: 12, minStop: 20, minLot: 0.001, lotStep: 0.001, valuePerPrice: 1, contractSize: 1, usdNotional: "quote" },
];

export const BUCKETS = [
  { label: "52–55%", lo: 0.52, hi: 0.55 },
  { label: "55–60%", lo: 0.55, hi: 0.6 },
  { label: "60–65%", lo: 0.6, hi: 0.65 },
  { label: "65%+", lo: 0.65, hi: 1.01 },
];

export const DEFAULT_SETTINGS: LabSettings = {
  moneyMode: "flat",
  baseStake: 0.63,
  bankroll: 10_000,
  leverageCap: 200,
  riskPercent: 0.0025,
  maxStakeFrac: MAX_STAKE_FRAC,
  kellyFraction: KELLY_FRACTION,
  martingaleEnabled: false,
  martingaleMult: 2,
  maxSteps: 2,
  dailyStopLoss: 50,
  dailyTakeProfit: 150,
  maxTradesDay: 5,
  maxConsecutiveLosses: 3,
  minEv: MIN_EV_R,
  safetyMargin: SAFETY_MARGIN,
  newsFilter: true,
  autoPaper: false,
  soundOn: false,
  otcSeparate: true,
  lang: "en",
  theme: "dark",
  density: "advanced",
};

export function assetMeta(id: AssetId) {
  return ASSETS.find((a) => a.id === id) ?? ASSETS[0]!;
}
