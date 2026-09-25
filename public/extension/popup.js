const pairEl = document.getElementById("pair");
const dirEl = document.getElementById("direction");
const qualityEl = document.getElementById("quality");
const targetsEl = document.getElementById("targets");
const noteEl = document.getElementById("note");
const ageEl = document.getElementById("age");

function show(text, kind) {
  noteEl.textContent = text;
  noteEl.className = kind || "";
}

function paint(status) {
  if (!status) {
    pairEl.textContent = "—";
    dirEl.textContent = "WAIT";
    dirEl.className = "WAIT";
    qualityEl.textContent = "Avoid";
    qualityEl.className = "Avoid";
    targetsEl.textContent = "No targets yet.";
    ageEl.textContent = "—";
    return;
  }
  const dir = status.direction === "BUY" || status.direction === "SELL" ? status.direction : "WAIT";
  pairEl.textContent = status.pair || "—";
  dirEl.textContent = dir === "BUY" ? "LONG" : dir === "SELL" ? "SHORT" : "WAIT";
  dirEl.className = dir;
  qualityEl.textContent = status.quality || "Avoid";
  qualityEl.className = status.quality || "Avoid";
  const t1 = status.target1 == null ? "—" : status.target1;
  const t2 = status.target2 == null ? "—" : status.target2;
  targetsEl.textContent = "Target 1 " + t1 + " · Target 2 " + t2;
  const age = status.at ? Math.max(0, Math.round((Date.now() - status.at) / 1000)) : 0;
  ageEl.textContent = age + "s";
  show(status.note || "Measured levels. Not a probability.", "");
}

async function pull() {
  const data = await chrome.storage.local.get(["exn_desk_url", "exn_desk_token"]);
  const url = data.exn_desk_url || "http://127.0.0.1:8090";
  const token = data.exn_desk_token || "exn_local_9c2e7a41b6d84f0e8a1c5d73e0b64f2a";
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/api/extension-status", {
      headers: { "x-desk-token": token },
    });
    const json = await res.json();
    if (!res.ok) {
      paint(null);
      show(json.error || "Desk refused the token.", "bad");
      return;
    }
    paint(json.status);
  } catch {
    paint(null);
    show("Desktop app is not open on 127.0.0.1:8090.", "bad");
  }
}

document.getElementById("settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

pull();
setInterval(pull, 10000);
