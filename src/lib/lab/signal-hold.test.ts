import assert from "node:assert/strict";
import test from "node:test";
import { shouldReplaceSignal } from "./signal-hold.ts";

test("a live call does not change while the same candle is still forming", () => {
  assert.equal(
    shouldReplaceSignal({ mode: "unverified", open: false, hasSignal: true, barDue: false, closedBarT: 60_000, heldBarT: 60_000 }),
    false,
  );
});

test("a live call updates when the next candle closes", () => {
  assert.equal(
    shouldReplaceSignal({ mode: "unverified", open: false, hasSignal: true, barDue: false, closedBarT: 120_000, heldBarT: 60_000 }),
    true,
  );
  assert.equal(
    shouldReplaceSignal({ mode: "unverified", open: false, hasSignal: true, barDue: true, closedBarT: 60_000, heldBarT: 60_000 }),
    true,
  );
});

test("the first read and an open ticket still scan", () => {
  assert.equal(
    shouldReplaceSignal({ mode: "unverified", open: false, hasSignal: false, barDue: false, closedBarT: 60_000, heldBarT: 0 }),
    true,
  );
  assert.equal(
    shouldReplaceSignal({ mode: "unverified", open: true, hasSignal: true, barDue: false, closedBarT: 60_000, heldBarT: 60_000 }),
    true,
  );
});
