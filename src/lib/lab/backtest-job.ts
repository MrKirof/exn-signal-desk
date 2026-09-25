import type { AssetId, BacktestReport, Candle, LabSettings, ModelRecord, Timeframe } from "./types.ts";
import { backtest } from "./backtest.ts";
import { DEFAULT_HORIZON_BARS, scoreForecast } from "./forecast.ts";

export interface BacktestJob {
  candles: Candle[];
  settings: LabSettings;
  model: ModelRecord;
  asset: AssetId;
  timeframe: Timeframe;
  source: string;
}

/** Pure. Safe to run on a worker thread. Does not touch the DOM. */
export function buildBacktestReport(job: BacktestJob): BacktestReport {
  const closed = job.candles.filter((c) => c.closed);
  const scored = scoreForecast(
    closed.map((c) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close })),
    { symbol: job.asset, timeframe: job.timeframe, source: job.source, horizonBars: DEFAULT_HORIZON_BARS },
  );
  const report = backtest({ candles: job.candles, settings: job.settings, model: job.model, folds: 4 });
  report.forecastValidation = {
    ...scored,
    source: job.source,
    symbol: job.asset,
    timeframe: job.timeframe,
    lastClosedTs: closed.at(-1)?.t ?? null,
  };
  return report;
}
