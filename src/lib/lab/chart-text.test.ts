import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../../../public/extension/chart-text.js", import.meta.url), "utf8");
vm.runInThisContext(code);
const parseChartText = globalThis.parseChartText as (text: string) => { asset: string; timeframe: string; bar: { open: number; high: number; low: number; close: number } | null };

test("the Exness chart header is read as EURUSD 1m OHLC", () => {
  const header = "EUR/USD Euro vs US Dollar · 1 · O 1.13765 H 1.13765 L 1.13762 C 1.13763 −0.00002";
  const got = parseChartText(header);
  assert.equal(got.asset, "EURUSD");
  assert.equal(got.timeframe, "1m");
  assert.deepEqual(got.bar, { open: 1.13765, high: 1.13765, low: 1.13762, close: 1.13763 });
});

test("a page with no OHLC does not invent a price", () => {
  const got = parseChartText("Open the Exness chart");
  assert.equal(got.asset, "");
  assert.equal(got.bar, null);
});
