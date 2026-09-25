import assert from "node:assert/strict";
import test from "node:test";
import { projectTargets, type Bar } from "./targets.ts";

function flat(n: number, close: number, span = 0.001): Bar[] {
  return Array.from({ length: n }, () => ({ high: close + span, low: close - span, close }));
}

test("a long target uses the nearest resistance and stays above price", () => {
  const bars = flat(20, 1.1);
  bars[8] = { high: 1.105, low: 1.099, close: 1.101 };
  bars[4] = { high: 1.101, low: 1.09, close: 1.1 };
  const plan = projectTargets("BUY", 1.1, bars);
  assert.ok(plan);
  assert.equal(plan.target1, 1.105);
  assert.ok(plan.target2 > plan.target1);
  assert.match(plan.target1Why, /nearest resistance/);
  assert.equal(plan.target1Why.includes("%"), false);
});

test("without a wall, target 1 is one ATR and not a guessed price", () => {
  const bars = flat(20, 1.1, 0.001);
  const plan = projectTargets("BUY", 1.1, bars);
  assert.ok(plan);
  assert.ok(Math.abs(plan.target1 - (1.1 + plan.atr)) < 1e-9);
  assert.match(plan.target1Why, /No resistance/);
});

test("a short target uses the nearest support and stays under price", () => {
  const bars = flat(20, 1.1);
  bars[8] = { high: 1.101, low: 1.094, close: 1.099 };
  const plan = projectTargets("SELL", 1.1, bars);
  assert.ok(plan);
  assert.equal(plan.target1, 1.094);
  assert.ok(plan.target2 < plan.target1);
});

test("a two-pip EURUSD wick is not treated as resistance", () => {
  const bars = flat(20, 1.1, 0.001);
  bars[8] = { high: 1.1002, low: 1.099, close: 1.1 };
  bars[12] = { high: 1.104, low: 1.099, close: 1.101 };
  const plan = projectTargets("BUY", 1.1, bars, 0.0001);
  assert.ok(plan);
  assert.equal(plan.target1, 1.104);
});

test("too few candles produce no target", () => {
  assert.equal(projectTargets("BUY", 1.1, flat(10, 1.1)), null);
});
