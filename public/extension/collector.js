/*! Isolated-world collector. Read-only. Builds candles from ticks when the page sends no history. */
(() => {
  if (window.__exnCollector30) return;
  window.__exnCollector30 = true;

  const state = {
    asset: "",
    assetSeen: false,
    timeframe: "1m",
    price: 0,
    bid: null,
    ask: null,
    payout: 0.85,
    otc: false,
    bars: [],
    ticks: 0,
    at: 0,
  };

  function normAsset(s) {
    const u = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (u.includes("XAU") || u.includes("GOLD")) return "XAUUSD";
    if (u.includes("BTC")) return "BTCUSD";
    if (u.includes("GBP") && u.includes("USD")) return "GBPUSD";
    if (u.includes("USD") && u.includes("JPY")) return "USDJPY";
    if (u.includes("EUR") && u.includes("USD")) return "EURUSD";
    return "";
  }
  function barMs(tf) {
    if (tf === "15s") return 15000;
    if (tf === "5m") return 300000;
    if (tf === "15m") return 900000;
    if (tf === "30m") return 1800000;
    if (tf === "1h") return 3600000;
    return 60000;
  }
  function toMs(t) {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return Date.now();
    return n < 1e12 ? n * 1000 : n;
  }
  function readBar(row) {
    if (!row) return null;
    if (Array.isArray(row) && row.length >= 5) {
      const t = toMs(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      if (!(open > 0) || !(close > 0)) return null;
      return { t, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume: Number(row[5]) || 0 };
    }
    const t = toMs(row.t || row.time || row.timestamp || row.from);
    const open = Number(row.open ?? row.o);
    const close = Number(row.close ?? row.c ?? row.price);
    const high = Number(row.high ?? row.h ?? close);
    const low = Number(row.low ?? row.l ?? close);
    if (!(open > 0) || !(close > 0)) return null;
    return { t, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume: Number(row.volume || 0) };
  }
  function foldTick(price) {
    const ms = barMs(state.timeframe);
    const t = Math.floor(Date.now() / ms) * ms;
    const last = state.bars[state.bars.length - 1];
    if (!last || last.t !== t) {
      state.bars.push({ t, open: price, high: price, low: price, close: price, volume: 1 });
      if (state.bars.length > 400) state.bars.shift();
    } else {
      last.close = price;
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.volume = (last.volume || 0) + 1;
    }
  }
  function snapshot(full) {
    const spread = state.bid > 0 && state.ask > 0 ? Math.max(0, state.ask - state.bid) : null;
    return {
      v: 1,
      source: "exness-collector",
      demo: false,
      partial: !full,
      at: Date.now(),
      asset: state.asset,
      timeframe: state.timeframe,
      symbol: state.asset,
      price: state.price,
      bid: state.bid,
      ask: state.ask,
      spread,
      ticks: state.ticks,
      payout: state.payout,
      otc: state.otc,
      bars: full ? state.bars.slice(-400) : state.bars.slice(-2),
    };
  }
  let lastShip = 0;
  let lastFull = 0;
  function ship(forceFull) {
    if (!(state.price > 0) || !state.assetSeen) return;
    const now = Date.now();
    const full = !!forceFull || now - lastFull > 400;
    if (!full && now - lastShip < 70) return;
    lastShip = now;
    if (full) lastFull = now;
    const snap = snapshot(full);
    try { chrome.runtime.sendMessage({ type: "exn-snapshot", snapshot: snap }); } catch (e) {}
    try { window.postMessage({ source: "exn-collector", snapshot: snap }, "*"); } catch (e) {}
  }

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.source !== "exn-collector-hook" || !d.payload) return;
    const p = d.payload;
    if (p.kind === "tick" && p.price > 0) {
      state.asset = normAsset(p.asset);
      if (!state.asset) return;
      state.assetSeen = true;
      state.price = Number(p.price);
      if (p.bid > 0) state.bid = Number(p.bid);
      if (p.ask > 0) state.ask = Number(p.ask);
      if (p.payout > 1) state.payout = Number(p.payout) / 100;
      else if (p.payout > 0.5) state.payout = Number(p.payout);
      state.otc = /otc/i.test(String(p.asset || ""));
      state.at = Date.now();
      state.ticks += 1;
      foldTick(state.price);
      ship(false);
    }
    if (p.kind === "candles" && Array.isArray(p.candles)) {
      const bars = [];
      for (const row of p.candles) {
        const b = readBar(row);
        if (b) bars.push(b);
      }
      if (bars.length >= 8) {
        state.bars = bars.slice(-400);
        if (p.asset) {
          const named = normAsset(p.asset);
          if (named) {
            state.asset = named;
            state.assetSeen = true;
          }
        }
        const last = state.bars[state.bars.length - 1];
        if (last) state.price = last.close;
        ship(true);
      }
    }
  });

  setInterval(() => ship(false), 200);
  setTimeout(() => ship(true), 300);

  function readTf(raw) {
    const u = String(raw || "").toUpperCase();
    if (u === "M5" || u === "5M") return "5m";
    if (u === "M15" || u === "15M") return "15m";
    if (u === "M30" || u === "30M") return "30m";
    if (u === "H1" || u === "1H") return "1h";
    if (u === "15S") return "15s";
    return "1m";
  }
  function pageText() {
    const parts = [];
    let n = 0;
    const walk = (node) => {
      if (!node || n > 20000 || parts.join(" ").length > 80000) return;
      n += 1;
      if (node.nodeType === 3) {
        const bit = node.textContent || "";
        if (bit.trim()) parts.push(bit);
        return;
      }
      if (node.shadowRoot) walk(node.shadowRoot);
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i += 1) walk(kids[i]);
    };
    walk(document.body || document.documentElement);
    return parts.join(" ");
  }
  function harvestDom() {
    const text = pageText();
    const header = typeof parseChartText === "function" ? parseChartText(text) : { asset: "", bar: null, timeframe: "" };
    if (header.asset) {
      state.asset = header.asset;
      state.assetSeen = true;
    }
    if (header.timeframe) state.timeframe = header.timeframe;
    if (header.bar) {
      state.price = header.bar.close;
      const ms = barMs(state.timeframe);
      const t = Math.floor(Date.now() / ms) * ms;
      const row = { t, open: header.bar.open, high: header.bar.high, low: header.bar.low, close: header.bar.close, volume: 1 };
      const last = state.bars[state.bars.length - 1];
      if (!last || last.t !== t) state.bars.push(row);
      else {
        last.high = Math.max(last.high, row.high);
        last.low = Math.min(last.low, row.low);
        last.close = row.close;
      }
      if (state.bars.length > 400) state.bars.shift();
      ship(false);
      return;
    }
    const nodes = document.querySelectorAll("[class*='bid'],[class*='ask'],[class*='price'],[class*='quote']");
    for (const el of nodes) {
      const t = (el.textContent || "").replace(/,/g, "");
      const n = t.match(/\d+\.\d+/);
      if (!n) continue;
      const v = Number(n[0]);
      if (!(v > 0)) continue;
      const cls = String(el.className || "").toLowerCase();
      if (cls.includes("bid")) state.bid = v;
      else if (cls.includes("ask")) state.ask = v;
      else if (!(state.price > 0)) state.price = v;
    }
    if (state.price > 0) {
      foldTick(state.price);
      ship(false);
    }
  }
  setInterval(harvestDom, 300);
  setTimeout(harvestDom, 400);
})();
