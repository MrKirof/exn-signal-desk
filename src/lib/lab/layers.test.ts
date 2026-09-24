import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("agent layer stays off the disk", () => {
  const src = readFileSync(new URL("./layers/agents.ts", import.meta.url), "utf8");
  assert.equal(/from ["'].*desk-io/.test(src), false);
  assert.equal(src.includes("node:fs"), false);
  assert.match(src, /postDesk/);
});

test("screen layers are separate", () => {
  const shell = readFileSync(new URL("../../components/lab/lab-shell.tsx", import.meta.url), "utf8");
  for (const name of ["Desk", "Health", "Risk", "Performance", "Backtest", "Journal", "Agents", "Settings", "Chart", "Signal"]) {
    assert.match(shell, new RegExp(`Layer name="${name}"`));
  }
});
