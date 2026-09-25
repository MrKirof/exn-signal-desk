import assert from "node:assert/strict";
import test from "node:test";
import { meanStretch } from "./stretch.ts";

test("a flat series is not stretched", () => {
  const row = meanStretch(Array.from({ length: 20 }, () => 1.1));
  assert.ok(row);
  assert.equal(row.stretched, false);
  assert.equal(row.z, 0);
});

test("a last print far from the mean is stretched", () => {
  const row = meanStretch([...Array.from({ length: 19 }, () => 1.1), 1.3]);
  assert.ok(row);
  assert.equal(row.stretched, true);
  assert.ok(row.z > 2);
});

test("too few closes produce no reading", () => {
  assert.equal(meanStretch(Array.from({ length: 19 }, () => 1.1)), null);
});
