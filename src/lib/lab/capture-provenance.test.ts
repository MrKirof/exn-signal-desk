import assert from "node:assert/strict";
import test from "node:test";
import { annotateCapture, isExnessTerminalHost } from "../../../public/extension/capture-provenance.js";
import { EXNESS_BROWSER_CAPTURE_VERIFIED, showsLiveExness } from "./provenance.ts";
import { collectorToSpot, parseCollector } from "./collector.ts";
import { feedClaim } from "./source-label.ts";

const candle = {
  source: "exness",
  asset: "EURUSD",
  symbol: "EURUSD",
  timeframe: "1m",
  price: 1.1,
  demo: false,
  venue: "Exness EURUSD",
  page: "https://exness.com.evil.example/trade",
  href: "https://notexness.com/trade",
  bars: [
    { t: Date.now() - 120_000, open: 1.1, high: 1.11, low: 1.09, close: 1.1 },
    { t: Date.now() - 60_000, open: 1.1, high: 1.12, low: 1.09, close: 1.101 },
  ],
};

test("a missing tab host is not a capture", () => {
  const snap = annotateCapture(null, candle);
  assert.equal(snap.capture.reason, "missing-host");
  assert.equal(snap.capture.host, "");
  assert.equal(snap.capture.fromTab, false);
  assert.equal(snap.page, undefined);
  assert.equal(snap.liveExness, false);
  assert.equal(showsLiveExness("exness", false), false);
});

test("lookalike hosts are rejected", () => {
  for (const host of ["exness.com.evil.example", "notexness.com", "exness.com.exness.evil.example", "evil-exness.com"]) {
    assert.equal(isExnessTerminalHost(host), false, host);
  }
  const snap = annotateCapture(
    { tab: { active: true, url: "https://exness.com.evil.example/terminal" }, url: "https://exness.com.evil.example/terminal" },
    candle,
  );
  assert.equal(snap.capture.reason, "invalid-host");
  assert.equal(snap.capture.host, "");
  assert.equal(snap.capture.fromTab, false);
  assert.equal(snap.liveExness, false);
});

test("fixture and demo candles are not live Exness even on a real tab and EURUSD", () => {
  const sender = { tab: { active: true, url: "https://my.exness.com/trading" }, url: "https://my.exness.com/trading" };
  for (const extra of [{ demo: true }, { venue: "fixture tape" }, { provenance: "demo" }]) {
    const snap = annotateCapture(sender, { ...candle, ...extra });
    assert.equal(snap.capture.reason, "fixture");
    assert.equal(snap.capture.fromTab, false);
    assert.equal(snap.demo, true);
    assert.equal(snap.liveExness, false);
    const parsed = parseCollector(snap);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const spot = collectorToSpot(parsed.snap);
    assert.equal(spot.source, "fixture");
    assert.equal(feedClaim(spot.source, !!spot.demo).liveExness, false);
  }
});

test("a valid active tab supplies the host and the payload host is ignored", () => {
  const snap = annotateCapture(
    { tab: { active: true, url: "https://my.exness.com/trading?x=1" }, url: "https://my.exness.com/trading?x=1" },
    candle,
  );
  assert.equal(snap.capture.reason, "captured-page");
  assert.equal(snap.capture.host, "my.exness.com");
  assert.equal(snap.capture.fromTab, true);
  assert.equal(snap.page, undefined);
  assert.equal(snap.href, undefined);
  assert.equal(snap.venue, undefined);
  assert.equal(snap.liveExness, false);
  assert.equal(EXNESS_BROWSER_CAPTURE_VERIFIED, false);
  assert.equal(isExnessTerminalHost("my.exness.com"), true);
  assert.equal(isExnessTerminalHost("trade.exness.global"), true);
  assert.equal(isExnessTerminalHost("exness.app"), true);
  const framed = annotateCapture(
    { tab: { active: true, url: "https://my.exness.com/webtrading/" }, url: "https://charts.exness.com/terminal" },
    candle,
  );
  assert.equal(framed.capture.fromTab, true);
  assert.equal(framed.capture.host, "my.exness.com");
  const foreignFrame = annotateCapture(
    { tab: { active: true, url: "https://my.exness.com/webtrading/" }, url: "https://evil.example/trade" },
    candle,
  );
  assert.equal(foreignFrame.capture.fromTab, false);
  const parsed = parseCollector(snap);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const spot = collectorToSpot(parsed.snap);
  assert.notEqual(spot.source, "exness");
  assert.equal(feedClaim(spot.source, !!spot.demo).liveExness, false);
  assert.equal(feedClaim(spot.source, !!spot.demo).text, "Unverified");
});
