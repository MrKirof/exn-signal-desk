import { atr } from "./indicators.ts";

/** Closed-candle sketch. Not a calibrated probability and not an Exness performance claim. */
export const DEFAULT_HORIZON_BARS = 3;
export const HORIZON_CHOICES = [1, 3, 6, 12] as const;

const PIP: Record<string, number> = {
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDJPY: 0.01,
  XAUUSD: 0.1,
  BTCUSD: 1,
};

export interface ForecastCandle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MoveForecast {
  symbol: string;
  timeframe: string;
  horizonBars: number;
  source: string;
  lastClosedTs: number | null;
  call: "UP" | "DOWN" | "SIDEWAYS" | "WAIT";
  calibrated: false;
  pipSize: number | null;
  bandLowPips: number | null;
  bandHighPips: number | null;
  bandLowPercent: number | null;
  bandHighPercent: number | null;
  sidewaysThresholdPrice: number | null;
  invalidation: string;
  note: string;
}

function finiteHorizon(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 48) return null;
  return n;
}

function pipSize(symbol: string) {
  return PIP[symbol.toUpperCase()] ?? null;
}

function toPips(priceDelta: number, pip: number | null) {
  if (pip == null || !(pip > 0)) return null;
  return priceDelta / pip;
}

export function forecastMove(input: {
  symbol: string;
  timeframe: string;
  source: string;
  horizonBars: number;
  candles: ForecastCandle[];
  stale?: boolean;
  spreadPrice?: number;
}): MoveForecast {
  const horizonBars = finiteHorizon(input.horizonBars);
  const base: MoveForecast = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    horizonBars: horizonBars ?? 0,
    source: input.source,
    lastClosedTs: input.candles.length ? input.candles[input.candles.length - 1]!.t : null,
    call: "WAIT",
    calibrated: false,
    pipSize: pipSize(input.symbol),
    bandLowPips: null,
    bandHighPips: null,
    bandLowPercent: null,
    bandHighPercent: null,
    sidewaysThresholdPrice: null,
    invalidation: "No forecast. There is nothing to invalidate.",
    note: "Uncalibrated. Not a probability and not a guaranteed price.",
  };
  if (horizonBars == null) {
    base.note = "No forecast. Choose a horizon of 1 to 48 closed candles.";
    return base;
  }
  if (input.stale) {
    base.note = "WAIT. The feed is stale, so no move estimate is shown.";
    return base;
  }
  const closed = input.candles.filter((c) => Number.isFinite(c.close) && c.close > 0 && c.high >= c.low);
  if (closed.length < 20) {
    base.note = "WAIT. Fewer than 20 closed candles.";
    base.lastClosedTs = closed.length ? closed[closed.length - 1]!.t : null;
    return base;
  }
  const highs = closed.map((c) => c.high);
  const lows = closed.map((c) => c.low);
  const closes = closed.map((c) => c.close);
  const width = atr(highs, lows, closes, 14);
  const price = closes[closes.length - 1]!;
  if (width == null || !(width > 0)) {
    base.note = "WAIT. Recent range is not usable.";
    base.lastClosedTs = closed[closed.length - 1]!.t;
    return base;
  }
  const lookback = 8;
  const drift = price - closes[closes.length - 1 - lookback]!;
  const noise = width * 0.35;
  const sigma = width * Math.sqrt(horizonBars);
  const projected = Math.max(-sigma * 0.5, Math.min(sigma * 0.5, drift * (horizonBars / lookback)));
  const spread = input.spreadPrice != null && input.spreadPrice > 0 ? input.spreadPrice : 0;
  if (sigma * 2 <= spread) {
    base.note = "WAIT. The range is inside the spread, so the move is not distinguishable from cost.";
    base.lastClosedTs = closed[closed.length - 1]!.t;
    base.sidewaysThresholdPrice = noise;
    return base;
  }
  const call = Math.abs(drift) < noise ? "SIDEWAYS" : drift > 0 ? "UP" : "DOWN";
  const pip = base.pipSize;
  const low = projected - sigma;
  const high = projected + sigma;
  return {
    ...base,
    lastClosedTs: closed[closed.length - 1]!.t,
    call,
    bandLowPips: toPips(low, pip),
    bandHighPips: toPips(high, pip),
    bandLowPercent: (low / price) * 100,
    bandHighPercent: (high / price) * 100,
    sidewaysThresholdPrice: noise,
    invalidation: "A later close beyond the opposite edge of this band, or an 8-candle drift that flips through zero, cancels the sketch.",
    note: `Uncalibrated band over the next ${horizonBars} closed ${input.timeframe} candles. Not a probability and not a guaranteed price. Not an Exness performance claim.`,
  };
}

export interface ForecastScore {
  softwareOnly: true;
  exnessPerformance: false;
  horizonBars: number;
  decided: number;
  abstained: number;
  directionHits: number;
  directionHitRate: number | null;
  magnitudeMaePips: number | null;
  intervalCoverage: number | null;
  note: string;
}

/** Chronological score. Bar i is decided before bars after i exist. */
export function scoreForecast(candles: ForecastCandle[], opts: { symbol: string; timeframe: string; source: string; horizonBars: number }): ForecastScore {
  const horizonBars = finiteHorizon(opts.horizonBars) ?? DEFAULT_HORIZON_BARS;
  let decided = 0;
  let abstained = 0;
  let hits = 0;
  let covered = 0;
  let absErr = 0;
  let errN = 0;
  const pip = pipSize(opts.symbol);
  for (let i = 19; i < candles.length - horizonBars; i++) {
    const view = candles.slice(0, i + 1);
    const forecast = forecastMove({ ...opts, horizonBars, candles: view });
    const actual = candles[i + horizonBars]!.close - candles[i]!.close;
    if (forecast.call === "WAIT" || forecast.sidewaysThresholdPrice == null) {
      abstained += 1;
      continue;
    }
    decided += 1;
    const noise = forecast.sidewaysThresholdPrice;
    const actualCall = Math.abs(actual) < noise ? "SIDEWAYS" : actual > 0 ? "UP" : "DOWN";
    if (actualCall === forecast.call) hits += 1;
    if (forecast.bandLowPips != null && forecast.bandHighPips != null && pip != null) {
      const actualPips = actual / pip;
      const mid = (forecast.bandLowPips + forecast.bandHighPips) / 2;
      absErr += Math.abs(actualPips - mid);
      errN += 1;
      if (actualPips >= forecast.bandLowPips && actualPips <= forecast.bandHighPips) covered += 1;
    }
  }
  return {
    softwareOnly: true,
    exnessPerformance: false,
    horizonBars,
    decided,
    abstained,
    directionHits: hits,
    directionHitRate: decided > 0 ? hits / decided : null,
    magnitudeMaePips: errN > 0 ? absErr / errN : null,
    intervalCoverage: errN > 0 ? covered / errN : null,
    note: "Software score on the supplied series only. Direction and magnitude are separate. This is not an Exness performance claim.",
  };
}
