/*! EXN collector — MAIN world, read-only wrap of WS/fetch/XHR. Never sends on page sockets. */
(() => {
  if (window.__exnHook21) return;
  window.__exnHook21 = true;
  const SRC = "exn-collector-hook";

  function emit(payload) {
    try {
      window.postMessage({ source: SRC, payload }, "*");
      if (window !== window.top) window.top.postMessage({ source: SRC, payload }, "*");
    } catch (e) {}
  }
  function toMs(t) {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  function scan(root) {
    if (!root) return;
    let n = 0;
    function emitTick(asset, price, extra) {
      const px = Number(price);
      if (!asset || !(px > 0)) return false;
      emit({ kind: "tick", asset, price: px, t: Date.now(), bid: extra && extra.bid, ask: extra && extra.ask, payout: extra && extra.payout });
      return true;
    }
    function walk(node, depth, asset) {
      if (!node || n++ > 800 || depth > 5) return;
      if (Array.isArray(node)) {
        if (node.length >= 3 && typeof node[0] === "string") {
          const px = Number(node[2]);
          if (px > 0) emit({ kind: "tick", asset: node[0], price: px, t: toMs(node[1]) || Date.now() });
          return;
        }
        if (node.length > 8 && node[0] && typeof node[0] === "object" && ("open" in node[0] || "o" in node[0])) {
          emit({ kind: "candles", asset, candles: node.slice(-400) });
          return;
        }
        const step = node.length > 40 ? 2 : 1;
        for (let i = 0; i < node.length; i += step) walk(node[i], depth + 1, asset);
        return;
      }
      if (typeof node !== "object") return;
      const a = node.asset || node.symbol || node.pair || node.instrument || asset;
      const price = Number(node.price ?? node.last ?? node.p ?? node.bid ?? node.ask);
      if (a && price > 0) emitTick(a, price, node);
      for (const key of ["candles", "history", "bars", "klines", "data", "ticks", "quotes"]) {
        if (Array.isArray(node[key]) && node[key].length > 8) emit({ kind: "candles", asset: a, candles: node[key].slice(-400) });
      }
      if (depth >= 4) return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === "object") walk(v, depth + 1, a);
      }
    }
    try { walk(root, 0, null); } catch (e) {}
  }
  function parseFrame(raw) {
    if (raw == null) return null;
    if (typeof raw !== "string") {
      try { return JSON.parse(new TextDecoder().decode(raw)); } catch (e) { return null; }
    }
    const s = raw.replace(/^\d+/, "").replace(/^#/, "");
    const i = s.indexOf("[") >= 0 && s.indexOf("{") > s.indexOf("[") ? s.indexOf("[") : s.indexOf("{");
    if (i < 0) {
      try { return JSON.parse(s); } catch (e) { return null; }
    }
    try { return JSON.parse(s.slice(i)); } catch (e) { return null; }
  }

  const NativeWS = window.WebSocket;
  function Wrapped(url, proto) {
    const ws = proto ? new NativeWS(url, proto) : new NativeWS(url);
    ws.addEventListener("message", (ev) => {
      try { scan(parseFrame(ev.data)); } catch (e) {}
    });
    return ws;
  }
  Wrapped.prototype = NativeWS.prototype;
  Wrapped.CONNECTING = NativeWS.CONNECTING;
  Wrapped.OPEN = NativeWS.OPEN;
  Wrapped.CLOSING = NativeWS.CLOSING;
  Wrapped.CLOSED = NativeWS.CLOSED;
  try { window.WebSocket = Wrapped; } catch (e) {}

  const nativeFetch = window.fetch;
  window.fetch = function () {
    const p = nativeFetch.apply(this, arguments);
    try {
      p.then((res) => {
        const c = (res.headers && res.headers.get("content-type")) || "";
        if (!/json/i.test(c)) return;
        res.clone().json().then(scan).catch(() => {});
      }).catch(() => {});
    } catch (e) {}
    return p;
  };

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function () {
    this.__exn = true;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        if (this.responseType && this.responseType !== "text" && this.responseType !== "json" && this.responseType !== "") return;
        const t = this.responseText || "";
        if (t[0] === "{" || t[0] === "[") scan(JSON.parse(t));
      } catch (e) {}
    });
    return XS.apply(this, arguments);
  };
})();
