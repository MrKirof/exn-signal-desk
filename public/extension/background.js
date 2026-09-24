import { bearer, normalizeDeskUrl } from "./desk-target.js";
import { annotateCapture } from "./capture-provenance.js";

const URL_KEY = "exn_desk_url";
const TOKEN_KEY = "exn_desk_token";

async function config() {
  const data = await chrome.storage.local.get([URL_KEY, TOKEN_KEY]);
  return { url: data[URL_KEY] || "", token: data[TOKEN_KEY] || "" };
}

function paintBadge(ok) {
  try {
    chrome.action.setBadgeText({ text: ok ? "ON" : "!" });
    chrome.action.setBadgeBackgroundColor({ color: ok ? "#3f9d73" : "#8a4b3a" });
  } catch (e) {}
}

let inflight = false;
let pending = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "exn-save") {
    void save(msg.url, msg.token).then(sendResponse);
    return true;
  }
  if (msg.type === "exn-ping") {
    void push({ hello: true, source: "exness-collector", at: Date.now() }).then(sendResponse);
    return true;
  }
  if (msg.type !== "exn-snapshot") return;
  const snap = annotateCapture(sender, msg.snapshot);
  if (snap.capture.fromTab !== true) {
    sendResponse({ ok: false, error: "Capture rejected. Use an active Exness terminal tab." });
    return;
  }
  chrome.storage.local.set({ exn_last_snapshot: snap });
  void push(snap).then((res) => sendResponse(res));
  return true;
});

async function save(url, token) {
  const desk = normalizeDeskUrl(url);
  if (!desk.ok) return desk;
  const auth = bearer(token);
  if (!auth.ok) return auth;
  const granted = await chrome.permissions.request({ origins: ["http://127.0.0.1/*"] });
  if (!granted) return { ok: false, error: "Chrome did not allow that desk URL." };
  await chrome.storage.local.set({ [URL_KEY]: desk.url, [TOKEN_KEY]: auth.token });
  return { ok: true };
}

async function push(snapshot) {
  pending = snapshot;
  if (inflight) return { ok: true, queued: true };
  inflight = true;
  let last = { ok: false, error: "Desk URL is not set." };
  try {
    while (pending) {
      const snap = pending;
      pending = null;
      last = await send(snap);
    }
  } finally {
    inflight = false;
  }
  return last;
}

async function send(snapshot) {
  const note = {
    at: Date.now(),
    asset: snapshot && snapshot.asset,
    price: snapshot && snapshot.price,
    bars: snapshot && snapshot.bars ? snapshot.bars.length : 0,
    spread: snapshot && snapshot.spread,
  };
  const cfg = await config();
  const desk = normalizeDeskUrl(cfg.url);
  if (!desk.ok) return { ...note, ok: false, error: desk.error };
  const auth = bearer(cfg.token);
  if (!auth.ok) return { ...note, ok: false, error: auth.error };
  let last = { ...note, ok: false, error: "Desk did not answer." };
  try {
    const res = await fetch(desk.url + "/api/collector", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-desk-token": auth.token },
      body: JSON.stringify(snapshot),
    });
    last = res.ok
      ? { ...note, ok: true, error: "" }
      : { ...note, ok: false, error: res.status === 401 ? "Token rejected." : "Desk answered " + res.status + "." };
  } catch (e) {
    last = { ...note, ok: false, error: "Could not reach the desk URL." };
  }
  await chrome.storage.local.set({ exn_link: last });
  paintBadge(last.ok);
  return last;
}
