import assert from "node:assert/strict";
import test from "node:test";
import { readSmc, riskWarning, timeframeMatrix, type Bar } from "./context-filters.ts";

function bar(i: number, open: number, high: number, low: number, close: number, timeframe = "1m"): Bar {
  return { t: 1_700_000_000_000 + i * 60_000, open, high, low, close, timeframe };
}

test("a three-candle gap is a fair value gap until price fills it", () => {
  const bars = [
    bar(0, 1.1, 1.101, 1.099, 1.1),
    bar(1, 1.1, 1.102, 1.1, 1.101),
    bar(2, 1.101, 1.103, 1.1005, 1.102),
    bar(3, 1.104, 1.106, 1.1035, 1.105),
  ];
  const read = readSmc(bars);
  assert.match(read.fvg, /Bullish fair value gap/);
});

test("equal swing highs are buy-side liquidity", () => {
  const bars = Array.from({ length: 12 }, (_, i) => bar(i, 1.1, 1.101, 1.099, 1.1));
  bars[3] = bar(3, 1.1, 1.12, 1.099, 1.101);
  bars[8] = bar(8, 1.1, 1.1201, 1.099, 1.101);
  const read = readSmc(bars);
  assert.match(read.liquidity, /Buy-side liquidity/);
});

test("a higher timeframe cannot be invented from a coarser feed", () => {
  const bars = Array.from({ length: 10 }, (_, i) => bar(i, 1, 1.01, 0.99, 1 + i * 0.001, "15m"));
  const matrix = timeframeMatrix(bars);
  assert.equal(matrix.cells.find((c) => c.label === "5M")?.note, "finer than the feed");
  assert.equal(matrix.strong, false);
});

test("a quiet book is not a strong three-timeframe signal", () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(i, 1.1, 1.1002, 1.0998, 1.1));
  assert.equal(timeframeMatrix(bars).strong, false);
});

test("an ATR spike suppresses the signal without a percentage", () => {
  const bars = Array.from({ length: 40 }, (_, i) => bar(i, 1.1, 1.1002, 1.0998, 1.1));
  bars[39] = bar(39, 1.1, 1.13, 1.07, 1.12);
  const risk = riskWarning(bars, null);
  assert.equal(risk.suppress, true);
  assert.match(risk.warning ?? "", /High Risk - Avoid Trading/);
  assert.equal((risk.warning ?? "").includes("%"), false);
});

test("high-impact news uses the same avoid-trading warning", () => {
  const bars = Array.from({ length: 40 }, (_, i) => bar(i, 1.1, 1.101, 1.099, 1.1));
  const risk = riskWarning(bars, "High-impact news in 10 minutes");
  assert.equal(risk.suppress, true);
  assert.match(risk.warning ?? "", /High-impact news in 10 minutes/);
});
