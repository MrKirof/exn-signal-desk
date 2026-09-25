import assert from "node:assert/strict";
import test from "node:test";

await import("./candle-batch.js");
const exnCandleBatch = globalThis.exnCandleBatch;

test("a list of time open high low close is kept", () => {
  const rows = Array.from({ length: 20 }, (_, i) => [1_700_000_000_000 + i * 60_000, 1.1, 1.12, 1.08, 1.11]);
  const got = exnCandleBatch(rows);
  assert.equal(got.length, 20);
});

test("a tick list is not called candles", () => {
  const ticks = Array.from({ length: 20 }, (_, i) => ["EURUSD", 1_700_000_000_000 + i, 1.1]);
  assert.equal(exnCandleBatch(ticks), null);
});

test("objects with open and close are kept", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ time: i, open: 1.1, high: 1.2, low: 1.0, close: 1.15 }));
  assert.equal(exnCandleBatch(rows).length, 8);
});
