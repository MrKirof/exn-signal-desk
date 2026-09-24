import assert from "node:assert/strict";
import test from "node:test";
import { collectorToSpot, parseCollector } from "./collector.ts";
import { dataOrigin, feedClaim, originLabel } from "./source-label.ts";
import { EXNESS_BROWSER_CAPTURE_VERIFIED, showsLiveExness } from "./provenance.ts";

const bars = [
  { t: Date.now() - 120_000, open: 1.1, high: 1.11, low: 1.09, close: 1.1 },
  { t: Date.now() - 60_000, open: 1.1, high: 1.12, low: 1.09, close: 1.111 },
];

function shown(raw: Record<string, unknown>) {
  const parsed = parseCollector({ asset: "EURUSD", timeframe: "1m", price: 1.111, bars, ...raw });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("parse failed");
  const spot = collectorToSpot(parsed.snap);
  const claim = feedClaim(spot.source, !!spot.demo);
  return { spot, claim, label: originLabel(dataOrigin(spot.source, !!spot.demo), false) };
}

test("no Exness browser-capture test has passed", () => {
  assert.equal(EXNESS_BROWSER_CAPTURE_VERIFIED, false);
});

test("a fixture that arrived through the collector stays a fixture and is not live Exness", () => {
  const { spot, claim, label } = shown({
    source: "exness",
    venue: "fixture, not the Exness terminal",
    provenance: "fixture",
    demo: false,
  });
  assert.equal(spot.source, "fixture");
  assert.equal(spot.demo, true);
  assert.equal(claim.liveExness, false);
  assert.equal(showsLiveExness(spot.source, !!spot.demo), false);
  assert.match(label, /Fixture/);
  assert.doesNotMatch(label, /Exness/);
  assert.doesNotMatch(claim.text, /Exness/);
});

test("unknown venue and a self-claimed Exness page stay unverified", () => {
  const samples = [
    {},
    { venue: "" },
    { venue: "Exness EURUSD", source: "exness" },
    { page: "https://my.exness.com/trade", source: "exness-collector" },
    { provenance: "exness", venue: "unknown" },
  ];
  for (const raw of samples) {
    const { spot, claim, label } = shown(raw);
    assert.equal(spot.source, "unverified");
    assert.equal(claim.liveExness, false);
    assert.equal(showsLiveExness("exness", false), false);
    assert.equal(label, "Unverified");
    assert.doesNotMatch(claim.text, /Exness|Live/);
  }
});
