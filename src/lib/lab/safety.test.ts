import assert from "node:assert/strict";
import test from "node:test";
import { makeCandle, normalizeBook } from "./candles.ts";
import { scanCandles } from "./candles-master.ts";
import { splitDecisionAndFill } from "./backtest.ts";
import { dataOrigin, originLabel } from "./source-label.ts";
import { levelBreak } from "../exness/ticket.ts";
import type { Candle } from "./types.ts";

function bar(i: number, o: number, h: number, l: number, c: number, source: Candle["source"] = "simulated"): Candle {
  return makeCandle({
    t: 1_700_000_000_000 + i * 60_000,
    open: o,
    high: h,
    low: l,
    close: c,
    asset: "EURUSD",
    timeframe: "1m",
    source,
    synthetic: true,
  });
}

function flat(n: number) {
  return Array.from({ length: n }, (_, i) => bar(i, 1.1, 1.101, 1.099, 1.1));
}

test("bullish engulfing is long only after the second candle closes", () => {
  const bars = [
    ...flat(8),
    bar(8, 1.102, 1.103, 1.098, 1.099),
    bar(9, 1.0985, 1.106, 1.098, 1.105),
  ];
  const scan = scanCandles(bars, "RANGE");
  assert.equal(scan.hits.some((h) => h.id === "bull_engulf" && h.direction === "BUY"), true);
  const forming = bars.map((b, i) => (i === bars.length - 1 ? { ...b, closed: false } : b));
  const closedOnly = forming.filter((b) => b.closed);
  const early = scanCandles(closedOnly, "RANGE");
  assert.equal(early.hits.some((h) => h.id === "bull_engulf"), false);
});

test("doji and inside bar do not invent a direction", () => {
  const doji = [...flat(8), bar(8, 1.1, 1.104, 1.096, 1.1002)];
  assert.equal(scanCandles(doji, "RANGE").hits.some((h) => h.id === "doji" && h.direction === "WAIT"), true);
  const inside = [...flat(8), bar(8, 1.09, 1.11, 1.08, 1.105), bar(9, 1.1, 1.104, 1.09, 1.101)];
  assert.equal(scanCandles(inside, "RANGE").hits.some((h) => h.id === "inside_bar" && h.direction === "WAIT"), true);
});

test("decision window cannot see the fill bar", () => {
  const bars = flat(5);
  const split = splitDecisionAndFill(bars, 2);
  assert.equal(split.seen.length, 3);
  assert.equal(split.seen.at(-1)?.t, bars[2]!.t);
  assert.equal(split.fill?.t, bars[3]!.t);
  assert.ok(split.seen.every((b) => b.t < split.fill!.t));
});

test("a close on the level is wait; the next close can break it", () => {
  assert.equal(levelBreak(1.1, 1.1), "WAIT");
  assert.equal(levelBreak(1.1001, 1.1), "BUY");
  assert.equal(levelBreak(1.0999, 1.1), "SELL");
  assert.equal(levelBreak(null, 1.1), "WAIT");
});

test("sources stay labeled and are not called Exness", () => {
  assert.equal(dataOrigin("exness", false), "unverified");
  assert.equal(originLabel(dataOrigin("exness", false), false), "Unverified");
  assert.equal(dataOrigin("exness", true), "demo");
  assert.equal(dataOrigin("yahoo"), "public");
  assert.equal(dataOrigin("kraken"), "public");
  assert.equal(dataOrigin("simulated"), "simulated");
  assert.equal(originLabel("public", true), "Public market · stale");
  assert.equal(originLabel("simulated", false), "Simulated");
});

test("duplicate and broken candles are counted, not treated as a clean Exness tape", () => {
  const a = bar(1, 1.1, 1.12, 1.09, 1.11, "yahoo");
  const dup = { ...a };
  const bad = bar(2, 1.1, 1.11, 1.09, 0, "yahoo");
  const { report } = normalizeBook([a, dup, bad], "1m", "EURUSD");
  assert.ok(report.duplicates >= 1);
  assert.ok(report.abnormalOhlc >= 1);
  assert.ok(report.quality < 1);
});
