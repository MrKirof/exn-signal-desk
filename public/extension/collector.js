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
    const full = !!forceFull || now - lastFull > 1200;
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
  function paintBadge() {
    const el = document.getElementById("exn-collector-badge");
    if (!el || !(state.price > 0)) return;
    el.textContent = state.asset + " " + state.timeframe + " " + state.price + " · " + state.bars.length + " bars · read-only";
  }
  function applyHeader(header) {
    if (!header) return false;
    if (header.asset) {
      state.asset = header.asset;
      state.assetSeen = true;
    }
    if (header.timeframe) state.timeframe = header.timeframe;
    if (!header.bar) return false;
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
    return true;
  }
  function nearLast(price) {
    if (!(state.price > 0)) return price > 0.2 && price < 500000;
    return Math.abs(price - state.price) / state.price < 0.002;
  }
  function noteText(text) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 180) return;
    const header = typeof parseChartText === "function" ? parseChartText(raw) : null;
    if (applyHeader(header)) {
      paintBadge();
      ship(false);
      return;
    }
    const lone = raw.match(/^(?:bid|ask|sell|buy)?\s*(\d{1,6}\.\d{2,5})$/i);
    const price = lone ? Number(lone[1]) : 0;
    if (!(price > 0) || !state.assetSeen || !nearLast(price)) return;
    state.price = price;
    foldTick(price);
    paintBadge();
    ship(false);
  }
  function seedHeader() {
    const root = document.body || document.documentElement;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    let buf = "";
    while (walker.nextNode() && n < 800) {
      n += 1;
      const bit = (walker.currentNode.textContent || "").replace(/\s+/g, " ").trim();
      if (!bit) continue;
      buf = (buf + " " + bit).slice(-2400);
      const header = typeof parseChartText === "function" ? parseChartText(buf) : null;
      if (header && header.bar && header.asset) {
        applyHeader(header);
        paintBadge();
        ship(true);
        return;
      }
    }
  }
  const seenRoots = new WeakSet();
  const observer = new MutationObserver((records) => {
    for (let i = 0; i < records.length && i < 40; i += 1) {
      const rec = records[i];
      if (rec.type === "characterData") noteText(rec.target && rec.target.textContent);
      else if (rec.target && rec.target.nodeType === 1) noteText((rec.target.textContent || "").slice(0, 180));
    }
  });
  function watch(root) {
    if (!root || seenRoots.has(root)) return;
    seenRoots.add(root);
    try { observer.observe(root, { subtree: true, characterData: true, childList: true }); } catch (e) {}
  }
  function arm() {
    watch(document.documentElement);
    seedHeader();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm, { once: true });
  else arm();
  setInterval(seedHeader, 2000);
})();
