/** Registrable hosts of the Exness web terminal. A lookalike must not match. */
export const TERMINAL_BASES = ["exness.com", "exness.global", "exness.app"];

/** @param {string} raw */
export function hostnameFromUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** Strict suffix match. `exness.com.evil.example` and `notexness.com` are rejected. */
/** @param {string} hostname */
export function isExnessTerminalHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("..") || !/^[a-z0-9.-]+$/.test(host)) return false;
  return TERMINAL_BASES.some((base) => host === base || host.endsWith("." + base));
}

/**
 * Chrome sets sender.tab.url for a content-script message. The candle payload is ignored.
 * @param {{ tab?: { url?: string, active?: boolean }, url?: string } | null | undefined} sender
 */
export function trustedTabUrl(sender) {
  const tab = sender && sender.tab;
  if (!tab || tab.active !== true) return "";
  const tabUrl = typeof tab.url === "string" ? tab.url : "";
  if (!tabUrl) return "";
  const tabHost = hostnameFromUrl(tabUrl);
  if (!tabHost) return "";
  if (!isExnessTerminalHost(tabHost)) return tabUrl;
  const frameUrl = sender && typeof sender.url === "string" ? sender.url : "";
  if (frameUrl) {
    const frameHost = hostnameFromUrl(frameUrl);
    if (!frameHost || !isExnessTerminalHost(frameHost)) return "";
  }
  return tabUrl;
}

/** @param {unknown} payload */
export function isFixturePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const row = /** @type {Record<string, unknown>} */ (payload);
  if (row.demo === true) return true;
  const blob = [row.venue, row.provenance, row.kind].map((v) => String(v ?? "")).join(" ");
  return /\bfixture\b|\bdemo\b|\btest\b/i.test(blob);
}

/**
 * Copy a snapshot and attach provenance only from the active tab.
 * A hostname inside the candle is dropped.
 * @param {{ tab?: { url?: string, active?: boolean }, url?: string } | null | undefined} sender
 * @param {unknown} payload
 * @returns {Record<string, any>}
 */
export function annotateCapture(sender, payload) {
  const snap = payload && typeof payload === "object" ? { .../** @type {Record<string, unknown>} */ (payload) } : {};
  delete snap.page;
  delete snap.href;
  delete snap.hostname;
  delete snap.host;
  delete snap.tabHost;
  delete snap.pageUrl;
  delete snap.venue;
  const fixture = isFixturePayload(payload);
  const tabUrl = trustedTabUrl(sender);
  const host = hostnameFromUrl(tabUrl);
  const allowed = isExnessTerminalHost(host);
  snap.demo = fixture;
  snap.liveExness = false;
  snap.capture = {
    fromTab: allowed && !fixture,
    host: allowed && !fixture ? host : "",
    reason: fixture ? "fixture" : !tabUrl ? "missing-host" : !allowed ? "invalid-host" : "captured-page",
  };
  return snap;
}
