import assert from "node:assert/strict";
import test from "node:test";
import { deskAuthed, sameOriginRequest } from "./desk-io.ts";
import { collectorToSpot, parseCollector } from "./collector.ts";
import { bearer, normalizeDeskUrl } from "../../../public/extension/desk-target.js";

test("empty token is rejected even when no desk token was configured", () => {
  assert.equal(deskAuthed(null, "http://127.0.0.1:8080"), false);
  assert.equal(deskAuthed("", "http://localhost:8080", ""), false);
  assert.equal(deskAuthed("   ", null, "   "), false);
});

test("extension target must be the local desktop receiver and must carry a token", () => {
  assert.equal(normalizeDeskUrl("").ok, false);
  assert.equal(normalizeDeskUrl("https://desk.example/lab").ok, false);
  assert.equal(normalizeDeskUrl("http://localhost:8090").ok, false);
  assert.equal(normalizeDeskUrl("http://127.0.0.1").ok, false);
  assert.equal(normalizeDeskUrl("https://user:pass@desk.example").ok, false);
  assert.equal(normalizeDeskUrl("http://127.0.0.1:8090/lab").ok, true);
  assert.equal(normalizeDeskUrl("http://127.0.0.1:8090/lab").url, "http://127.0.0.1:8090");
  assert.equal(bearer("").ok, false);
  assert.equal(bearer("   ").ok, false);
  assert.equal(bearer("exn_abc").ok, true);
});

test("a collector payload with no venue stays unverified", () => {
  const parsed = parseCollector({
    source: "exness-collector",
    asset: "EURUSD",
    timeframe: "1m",
    price: 1.1,
    bid: 1.0999,
    ask: 1.1001,
    demo: false,
    bars: [
      { t: Date.now() - 120_000, open: 1.099, high: 1.101, low: 1.098, close: 1.1 },
      { t: Date.now() - 60_000, open: 1.1, high: 1.102, low: 1.099, close: 1.101 },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const spot = collectorToSpot(parsed.snap);
  assert.equal(spot.source, "unverified");
  assert.notEqual(spot.source, "exness");
});

test("pair token is not issued to a cross-site caller", () => {
  assert.equal(sameOriginRequest("https://desk.example/api/desk", "https://evil.example", null), false);
  assert.equal(sameOriginRequest("https://desk.example/api/desk", "https://desk.example", null), true);
});
