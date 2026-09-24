import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureToken, prepareDesktopEnv, readToken, resetToken, verifyToken } from "../../../desktop/pair.mjs";
import { startReceiver } from "../../../desktop/receiver.mjs";
import { annotateCapture } from "../../../public/extension/capture-provenance.js";
import { collectorToSpot, parseCollector } from "./collector.ts";
import { feedClaim } from "./source-label.ts";
import { EXNESS_BROWSER_CAPTURE_VERIFIED } from "./provenance.ts";

test("desktop startup ignores a hosted DATABASE_URL", () => {
  const env = prepareDesktopEnv({ DATABASE_URL: "postgres://hosted.example/db", DESK_DATA: "/tmp/local-desk" });
  assert.equal("DATABASE_URL" in env, false);
  assert.equal(env.DESK_DATA, "/tmp/local-desk");
});

test("missing, empty, and invalid tokens are rejected, and reset revokes the old one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exn-pair-"));
  assert.equal(verifyToken(dir, "anything"), false);
  const token = ensureToken(dir);
  assert.equal(verifyToken(dir, ""), false);
  assert.equal(verifyToken(dir, "   "), false);
  assert.equal(verifyToken(dir, "not-the-token"), false);
  assert.equal(verifyToken(dir, token), true);
  const next = resetToken(dir);
  assert.notEqual(next, token);
  assert.equal(verifyToken(dir, token), false);
  assert.equal(verifyToken(dir, next), true);
  assert.equal(readToken(dir), next);
});

test("local receiver rejects bad tokens, accepts a candle, and does not place orders", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exn-recv-"));
  const ui = fs.mkdtempSync(path.join(os.tmpdir(), "exn-ui-"));
  fs.writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>desk</title>");
  await assert.rejects(() => startReceiver({ host: "0.0.0.0", dataDir: dir, uiDir: ui, port: 0 }), /127\.0\.0\.1/);
  const started = await startReceiver({ host: "127.0.0.1", dataDir: dir, uiDir: ui, port: 0 });
  const base = `http://127.0.0.1:${started.port}`;
  try {
    const addr = started.server.address();
    assert.equal(typeof addr === "object" && addr ? addr.address : "", "127.0.0.1");
    const health = await fetch(base + "/api/health");
    const healthBody = await health.json();
    assert.equal(healthBody.databaseUrl, false);
    assert.equal(JSON.stringify(healthBody).includes(started.token), false);
    const missing = await fetch(base + "/api/collector");
    assert.equal(missing.status, 401);
    const empty = await fetch(base + "/api/collector", { headers: { "x-desk-token": "   " } });
    assert.equal(empty.status, 401);
    const invalid = await fetch(base + "/api/collector", { headers: { "x-desk-token": "nope" } });
    assert.equal(invalid.status, 401);
    const leaked = await fetch(base + "/api/desk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pair" }) });
    const leakedBody = await leaked.text();
    assert.equal(leaked.status, 403);
    assert.equal(leakedBody.includes(started.token), false);
    const order = await fetch(base + "/api/order", { method: "POST", headers: { "x-desk-token": started.token } });
    assert.equal(order.status, 404);
    const sender = { tab: { active: true, url: "https://my.exness.com/trade" }, url: "https://my.exness.com/trade" };
    const snap = annotateCapture(sender, {
      source: "exness",
      venue: "Exness EURUSD",
      page: "https://exness.com.evil.example/trade",
      asset: "EURUSD",
      timeframe: "1m",
      price: 1.1,
      demo: false,
      bars: [
        { t: 1_700_000_000_000, open: 1.1, high: 1.11, low: 1.09, close: 1.101 },
        { t: 1_700_000_060_000, open: 1.101, high: 1.12, low: 1.1, close: 1.11 },
      ],
    });
    const put = await fetch(base + "/api/collector", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-desk-token": started.token },
      body: JSON.stringify(snap),
    });
    assert.equal(put.status, 200);
    const got = await fetch(base + "/api/collector", { headers: { "x-desk-token": started.token } });
    const body = await got.json();
    assert.equal(body.snapshot.capture.host, "my.exness.com");
    assert.equal(body.snapshot.page, undefined);
    const parsed = parseCollector(body.snapshot);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const spot = collectorToSpot(parsed.snap);
    assert.notEqual(spot.source, "exness");
    assert.equal(feedClaim(spot.source, !!spot.demo).liveExness, false);
    assert.equal(EXNESS_BROWSER_CAPTURE_VERIFIED, false);
    const fixture = annotateCapture(sender, { ...snap, demo: true, venue: "fixture" });
    const parsedFixture = parseCollector(fixture);
    assert.equal(parsedFixture.ok, true);
    if (!parsedFixture.ok) return;
    assert.equal(collectorToSpot(parsedFixture.snap).source, "fixture");
    assert.equal(feedClaim("fixture", true).text, "Fixture · test");
    const reset = await fetch(base + "/api/token/reset", { method: "POST", headers: { "x-desk-token": started.token } });
    const resetBody = await reset.json();
    assert.equal(reset.ok, true);
    const after = await fetch(base + "/api/collector", { headers: { "x-desk-token": started.token } });
    assert.equal(after.status, 401);
    const withNew = await fetch(base + "/api/collector", { headers: { "x-desk-token": resetBody.token } });
    assert.equal(withNew.status, 200);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
});

test("desktop and extension sources do not place orders", () => {
  const files = [
    "desktop/receiver.mjs",
    "desktop/main.cjs",
    "public/extension/background.js",
    "public/extension/collector.js",
    "public/extension/collector-hook.js",
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8").toLowerCase();
    assert.equal(/ordersend|placeorder|mt5\.order|broker\.buy|click\(\s*['"]buy/.test(text), false, file);
  }
});
