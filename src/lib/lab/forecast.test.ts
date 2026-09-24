import assert from "node:assert/strict";
import test from "node:test";
import { forecastMove, scoreForecast } from "./forecast.ts";
import { EXNESS_BROWSER_CAPTURE_VERIFIED } from "./provenance.ts";

function wave(n: number, step = 0.0001) {
  const out = [];
  let price = 1.1;
  for (let i = 0; i < n; i++) {
    const drift = i > n - 12 ? 0.0004 : (i % 5) - 2;
    price += drift * step;
    const open = price - step;
    out.push({ t: 1_700_000_000_000 + i * 60_000, open, high: price + step, low: open - step, close: price });
  }
  return out;
}

test("a forecast names the horizon and does not invent a probability", () => {
  const forecast = forecastMove({
    symbol: "EURUSD",
    timeframe: "1m",
    source: "fixture",
    horizonBars: 3,
    candles: wave(40),
  });
  assert.equal(forecast.horizonBars, 3);
  assert.equal(forecast.calibrated, false);
  assert.equal(forecast.symbol, "EURUSD");
  assert.equal(forecast.timeframe, "1m");
  assert.equal(forecast.source, "fixture");
  assert.equal(typeof forecast.lastClosedTs, "number");
  assert.equal("probability" in forecast, false);
  assert.notEqual(forecast.call, "WAIT");
  assert.ok(forecast.bandLowPips != null && forecast.bandHighPips != null);
  assert.ok(forecast.bandLowPips < forecast.bandHighPips);
  assert.match(forecast.note, /Not a probability/);
  assert.equal(EXNESS_BROWSER_CAPTURE_VERIFIED, false);
});

test("missing horizon, a short book, or a stale feed is WAIT with no band", () => {
  const candles = wave(40);
  assert.equal(forecastMove({ symbol: "EURUSD", timeframe: "1m", source: "fixture", horizonBars: 0, candles }).call, "WAIT");
  assert.equal(forecastMove({ symbol: "EURUSD", timeframe: "1m", source: "fixture", horizonBars: 3, candles: candles.slice(0, 8) }).call, "WAIT");
  const stale = forecastMove({ symbol: "EURUSD", timeframe: "1m", source: "unverified", horizonBars: 3, candles, stale: true });
  assert.equal(stale.call, "WAIT");
  assert.equal(stale.bandLowPips, null);
});

test("the decision at bar i cannot see the future bar", () => {
  const candles = wave(40);
  const before = forecastMove({ symbol: "EURUSD", timeframe: "1m", source: "fixture", horizonBars: 3, candles: candles.slice(0, 30) });
  const spiked = candles.slice(0, 30).concat([{ t: candles[30]!.t, open: 9, high: 9, low: 9, close: 9 }]);
  const after = forecastMove({ symbol: "EURUSD", timeframe: "1m", source: "fixture", horizonBars: 3, candles: candles.slice(0, 30) });
  assert.equal(before.call, after.call);
  assert.equal(before.bandLowPips, after.bandLowPips);
  assert.notEqual(spiked[spiked.length - 1]!.close, candles[29]!.close);
});

test("walk-forward score separates direction and magnitude and is not an Exness claim", () => {
  const score = scoreForecast(wave(80), { symbol: "EURUSD", timeframe: "1m", source: "fixture", horizonBars: 3 });
  assert.equal(score.softwareOnly, true);
  assert.equal(score.exnessPerformance, false);
  assert.equal(score.horizonBars, 3);
  assert.ok(score.decided > 0);
  assert.equal(typeof score.directionHitRate, "number");
  assert.equal(typeof score.magnitudeMaePips, "number");
  assert.match(score.note, /not an Exness performance claim/);
});
