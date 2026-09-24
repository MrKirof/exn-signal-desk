/**
 * Live Exness is a display claim, not a transport claim.
 * Nothing in this process has passed a real Exness browser-capture test, so this stays false.
 */
export const EXNESS_BROWSER_CAPTURE_VERIFIED = false;

export type QuoteKind = "fixture" | "unverified" | "exness";

export function classifyQuote(input: {
  venue?: unknown;
  source?: unknown;
  demo?: unknown;
  provenance?: unknown;
  page?: unknown;
}): QuoteKind {
  const blob = [input.venue, input.source, input.provenance].map((v) => String(v ?? "")).join(" ");
  if (input.demo === true || /\bfixture\b|\bdemo\b|\btest\b/i.test(blob)) return "fixture";
  // A page, href, or hostname written inside the candle is not tab metadata.
  // The verification flag stays false, so this never returns a live Exness claim.
  void input.page;
  void EXNESS_BROWSER_CAPTURE_VERIFIED;
  return "unverified";
}

export function showsLiveExness(source: string, demo = false) {
  return EXNESS_BROWSER_CAPTURE_VERIFIED && source === "exness" && demo !== true;
}
