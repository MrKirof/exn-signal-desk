export type Direction = "BUY" | "SELL" | "WAIT";
export type OutcomeKind = "WIN" | "LOSS" | "TIE";
export type Lifecycle =
  | "IDLE"
  | "COLLECTING"
  | "ANALYZING"
  | "READY"
  | "EXPIRED"
  | "SETTLING"
  | "SETTLED";
export type Regime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "EXPANSION"
  | "HIGH_VOLATILITY"
  | "DEAD"
  | "MIXED"
  | "TRANSITION";
export type MarketType = "LIVE" | "OTC";
export type DataSource = "kraken" | "coinbase" | "yahoo" | "exness" | "fixture" | "unverified" | "simulated" | "replay" | "websocket";
export type AssetId = "EURUSD" | "GBPUSD" | "USDJPY" | "XAUUSD" | "BTCUSD";
export type Timeframe = "15s" | "1m" | "5m" | "15m" | "30m" | "1h";
export type MoneyMode = "flat" | "kelly" | "compound" | "martingale" | "anti-martingale";
export type CalibrationStatus = "none" | "weak" | "usable" | "ok";
export type ViewId =
  | "desk"
  | "health"
  | "risk"
  | "performance"
  | "backtest"
  | "journal"
  | "settings"
  | "agents";
export type Lang = "en" | "bn";
export type Theme = "dark" | "light";
export type Density = "compact" | "advanced";
export type NewsImpact = "low" | "medium" | "high";
export type StructureZone = "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
export type SessionName = "ASIA" | "LONDON" | "NEW_YORK" | "OVERLAP" | "OFF";
export type CandleRole = "reversal" | "continuation" | "compression" | "indecision";

export interface SessionInfo {
  name: SessionName;
  label: string;
  hourUtc: number;
  active: boolean;
}

export interface StructureInfo {
  swingHigh: number;
  swingLow: number;
  eq: number;
  zone: StructureZone;
  bos: Direction | "NONE";
  pos: number;
}

export interface ConfluenceItem {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Confluence {
  score: number;
  max: number;
  grade: "weak" | "ok" | "strong";
  items: ConfluenceItem[];
}

export interface CandleHit {
  id: string;
  name: string;
  bars: 1 | 2 | 3;
  direction: Direction;
  role: CandleRole;
  geometry: number;
  context: number;
  score: number;
  why: string;
}

export interface CandleScan {
  hits: CandleHit[];
  best: CandleHit | null;
  priorTrend: "UP" | "DOWN" | "FLAT";
  rangeAtr: number;
}

export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  asset: AssetId;
  timeframe: Timeframe;
  source: DataSource;
  receivedAt: number;
  latencyMs: number;
  payout: number;
  marketType: MarketType;
  otc: boolean;
  synthetic: boolean;
  closed: boolean;
}

export interface IntegrityReport {
  duplicates: number;
  outOfOrder: number;
  gaps: number;
  abnormalOhlc: number;
  missing: number;
  quality: number;
  reasons: string[];
}

export interface Features {
  version: string;
  ret1: number;
  ret3: number;
  ret5: number;
  ret10: number;
  ret20: number;
  bodyRatio: number;
  upperWick: number;
  lowerWick: number;
  rangeAtr: number;
  gapSize: number;
  momAccel: number;
  distHigh: number;
  distLow: number;
  swing: number;
  breakout: number;
  rsi: number;
  rsiSlope: number;
  rsiDiv: number;
  macdHist: number;
  macdSlope: number;
  emaDist: number;
  emaAlign: number;
  bbPos: number;
  bbWidth: number;
  atrPct: number;
  adx: number;
  stoch: number;
  cci: number;
  roc: number;
  vwapDist: number;
  hour: number;
  dow: number;
  payout: number;
  otc: number;
  timeToClose: number;
  newsMin: number;
  recentHit: number;
  efficiencyRatio: number;
  atrExpansion: number;
}

export interface StrategyVote {
  name: string;
  direction: Direction;
  probability: number;
  strength: number;
  reasons: string[];
  invalidation: string[];
  regimeFit: number;
  stop: number;
  target: number;
}

export type JevAction = "BUY" | "SELL" | "HOLD";

export interface JevBot {
  name: string;
  read: string;
  side: JevAction;
  status: "Verified" | "Inferred" | "Unknown";
}

export interface JevRead {
  action: JevAction;
  confidence: number;
  note: string;
  bots: JevBot[];
}

export interface Signal {
  predictionId: string;
  signalKey: string;
  lifecycle: Lifecycle;
  direction: Direction;
  rawScore: number;
  rawProbability: number;
  calibratedProbability: number;
  calibrationStatus: CalibrationStatus;
  historicalWinRate: number | null;
  sampleSize: number;
  expectedValue: number;
  expectedValueR: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  createdAt: number;
  validUntil: number;
  ageMs: number;
  regime: Regime;
  dataQuality: number;
  reasons: string[];
  against: string[];
  invalidation: string[];
  recommendedStake: number;
  recommendedLots: number;
  suggestedLeverage: number;
  marginUsd: number;
  notionalUsd: number;
  dailyRiskUsed: number;
  strategies: StrategyVote[];
  features: Features;
  modelVersion: string;
  strategyVersion: string;
  featureVersion: string;
  cancelledReason: string | null;
  asset: AssetId;
  timeframe: Timeframe;
  marketType: MarketType;
  otc: boolean;
  synthetic: boolean;
  session: SessionInfo;
  structure: StructureInfo;
  confluence: Confluence;
  pendingDirection: Direction;
  candle: CandleScan;
  jev: JevRead | null;
}

export interface Outcome {
  predictionId: string;
  entryPrice: number;
  exitPrice: number;
  kind: OutcomeKind;
  grossProfit: number;
  stake: number;
  outcomeR: number;
  latencyMs: number;
  automatic: boolean;
  settlementSource: "engine" | "manual" | "backtest";
  settledAt: number;
  asset: AssetId;
  direction: Direction;
  calibratedProbability: number;
  regime: Regime;
  strategy: string;
  ambiguousPath: boolean;
}

export interface RiskState {
  bankroll: number;
  peakEquity: number;
  equity: number;
  dailyPnl: number;
  dailyTrades: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  progressionStep: number;
  pauseUntil: number;
  killed: boolean;
  dailyStopHit: boolean;
  dailyTpHit: boolean;
  remainingLossBudget: number;
}

export interface HealthState {
  connected: boolean;
  lastCandleAt: number;
  interval: Timeframe;
  missing: number;
  duplicates: number;
  outOfOrder: number;
  modelLoaded: boolean;
  workerLatencyMs: number;
  newsFreshAt: number;
  asset: AssetId;
  payout: number;
  payoutAt: number;
  source: DataSource;
}

export interface NewsEvent {
  id: string;
  t: number;
  currency: string;
  title: string;
  impact: NewsImpact;
  actual: string | null;
}

export interface LabSettings {
  moneyMode: MoneyMode;
  baseStake: number;
  bankroll: number;
  leverageCap: number;
  riskPercent: number;
  maxStakeFrac: number;
  kellyFraction: number;
  martingaleEnabled: boolean;
  martingaleMult: number;
  maxSteps: number;
  dailyStopLoss: number;
  dailyTakeProfit: number;
  maxTradesDay: number;
  maxConsecutiveLosses: number;
  minEv: number;
  safetyMargin: number;
  newsFilter: boolean;
  autoPaper: boolean;
  soundOn: boolean;
  otcSeparate: boolean;
  lang: Lang;
  theme: Theme;
  density: Density;
}

export interface ModelRecord {
  version: string;
  trainedAt: number;
  trainFrom: number;
  trainTo: number;
  featureVersion: string;
  assets: AssetId[];
  method: string;
  calibration: "none" | "platt" | "isotonic";
  brierTrain: number | null;
  brierHoldout: number | null;
  loglossHoldout: number | null;
  weights: number[];
  bias: number;
  plattA: number;
  plattB: number;
  isoBlocks: { lo: number; hi: number; mean: number }[];
  champion: boolean;
}

export interface BucketStat {
  label: string;
  lo: number;
  hi: number;
  n: number;
  wins: number;
  winRate: number;
  avgEv: number;
}

export interface BacktestReport {
  ranAt: number;
  bars: number;
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  netProfit: number;
  profitFactor: number;
  maxDrawdown: number;
  expectancyR: number;
  brier: number | null;
  logloss: number | null;
  longestLose: number;
  byAsset: Record<string, { n: number; wr: number; pnl: number }>;
  byRegime: Record<string, { n: number; wr: number; pnl: number }>;
  byStrategy: Record<string, { n: number; wr: number; pnl: number }>;
  buckets: BucketStat[];
  walkForward: { fold: number; wr: number; brier: number | null; pnl: number }[];
  leakageSafe: true;
  note: string;
  blocks: { reason: string; n: number }[];
}
