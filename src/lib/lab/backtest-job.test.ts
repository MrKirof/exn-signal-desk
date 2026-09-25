import assert from "node:assert/strict";
import test from "node:test";
import { buildBacktestReport } from "./backtest-job.ts";
import { emptyModel } from "./models.ts";
import { DEFAULT_SETTINGS } from "./constants.ts";
import type { Candle } from "./types.ts";

test("the backtest job runs without the page thread", () => {
  const candles: Candle[] = Array.from({ length: 80 }, (_, i) => ({
    t: 1_700_000_000_000 + i * 60_000,
    open: 1.1 + i * 0.0001,
    high: 1.101 + i * 0.0001,
    low: 1.099 + i * 0.0001,
    close: 1.1 + i * 0.0001,
    volume: 1,
    asset: "EURUSD",
    timeframe: "1m",
    closed: true,
    source: "fixture",
    synthetic: true,
    receivedAt: 1_700_000_000_000,
    latencyMs: 0,
    payout: 0.85,
    otc: false,
    marketType: "LIVE",
  }));
  const report = buildBacktestReport({
    candles,
    settings: DEFAULT_SETTINGS,
    model: emptyModel(),
    asset: "EURUSD",
    timeframe: "1m",
    source: "Fixture · test",
  });
  assert.equal(report.leakageSafe, true);
  assert.equal(report.forecastValidation?.exnessPerformance, false);
  assert.equal(report.forecastValidation?.source, "Fixture · test");
});
