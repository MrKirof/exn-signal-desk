export const LOCAL_DESK_TOKEN = "exn_local_9c2e7a41b6d84f0e8a1c5d73e0b64f2a";
/** @param {string} raw */
export function normalizeDeskUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, error: "Set the local desk address first." };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That desk address is not valid." };
  }
  if (url.protocol !== "http:") return { ok: false, error: "The desktop receiver is http://127.0.0.1 only." };
  if (url.hostname !== "127.0.0.1") return { ok: false, error: "Only 127.0.0.1 is allowed. A public desk URL is not used." };
  if (url.port !== "8090") return { ok: false, error: "Use the desktop receiver at http://127.0.0.1:8090." };
  if (url.username || url.password) return { ok: false, error: "Do not put a password in the URL." };
  return { ok: true, url: url.origin };
}

/** @param {string} raw */
export function bearer(raw) {
  const token = String(raw || "").trim();
  if (!token) return { ok: false, error: "Paste the desk token. An empty token is rejected." };
  return { ok: true, token };
}
