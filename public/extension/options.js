const statusEl = document.getElementById("status");
const liveEl = document.getElementById("live");
const urlEl = document.getElementById("url");
const tokenEl = document.getElementById("token");

function paint(snap, link) {
  if (!snap || !(snap.price > 0)) {
    liveEl.textContent = link && link.error ? link.error : "No quote yet. Open the Exness chart.";
    liveEl.className = link && link.ok ? "ok" : "";
    return;
  }
  const spread = snap.spread > 0 ? " · spread " + snap.spread : "";
  const age = snap.at ? Math.max(0, Math.round((Date.now() - snap.at) / 1000)) : 0;
  const linkTxt = link && link.ok ? "desk linked" : link && link.error ? link.error : "desk not checked";
  liveEl.textContent = snap.asset + " " + snap.timeframe + " " + snap.price + spread + " · " + (snap.bars ? snap.bars.length : 0) + " bars · " + age + "s · " + linkTxt;
  liveEl.className = link && link.ok ? "ok" : "bad";
}

chrome.storage.local.get(["exn_desk_url", "exn_desk_token", "exn_last_snapshot", "exn_link"], (data) => {
  urlEl.value = data.exn_desk_url || "http://127.0.0.1:8090";
  tokenEl.value = data.exn_desk_token || "";
  paint(data.exn_last_snapshot, data.exn_link);
});
setInterval(() => {
  chrome.storage.local.get(["exn_last_snapshot", "exn_link"], (data) => paint(data.exn_last_snapshot, data.exn_link));
}, 1000);

document.getElementById("save").addEventListener("click", () => {
  statusEl.textContent = "Saving…";
  chrome.runtime.sendMessage({ type: "exn-save", url: urlEl.value, token: tokenEl.value }, (res) => {
    statusEl.textContent = res && res.ok ? "Saved. No order is sent." : (res && res.error) || "Save failed.";
    statusEl.className = res && res.ok ? "ok" : "bad";
  });
});

document.getElementById("test").addEventListener("click", () => {
  statusEl.textContent = "Checking the desk…";
  chrome.runtime.sendMessage({ type: "exn-ping" }, (res) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = "Extension did not answer. Reload it in chrome://extensions.";
      statusEl.className = "bad";
      return;
    }
    statusEl.textContent = res && res.ok ? "Linked to the desk." : (res && res.error) || "Desk did not answer.";
    statusEl.className = res && res.ok ? "ok" : "bad";
  });
});
