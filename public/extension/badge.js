(() => {
  if (window !== window.top) return;
  if (document.getElementById("exn-collector-badge")) return;
  const el = document.createElement("div");
  el.id = "exn-collector-badge";
  el.textContent = "Collector — waiting for quotes";
  document.documentElement.appendChild(el);
  function paint(s) {
    if (!s || !(s.price > 0)) return;
    const spread = s.spread > 0 ? " · spr " + s.spread : "";
    el.textContent = s.asset + " " + s.timeframe + " " + s.price + spread + " · " + (s.bars ? s.bars.length : 0) + " bars · read-only";
  }
  chrome.storage.local.get("exn_last_snapshot", (data) => paint(data.exn_last_snapshot));
  setInterval(() => {
    chrome.storage.local.get("exn_last_snapshot", (data) => paint(data.exn_last_snapshot));
  }, 1000);
})();
