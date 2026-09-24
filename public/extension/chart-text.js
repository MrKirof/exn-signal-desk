/** Read the symbol and OHLC printed on the Exness chart header. Read-only. */
function parseChartText(text) {
  const raw = String(text || "").replace(/\u00a0/g, " ");
  let asset = "";
  const sym = raw.match(/\b(EUR\/USD|GBP\/USD|USD\/JPY|XAU\/USD|BTC\/USD|EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSD)\b/i);
  if (sym) {
    const u = sym[1].toUpperCase().replace(/[^A-Z]/g, "");
    if (u.includes("XAU") || u.includes("GOLD")) asset = "XAUUSD";
    else if (u.includes("BTC")) asset = "BTCUSD";
    else if (u.includes("GBP") && u.includes("USD")) asset = "GBPUSD";
    else if (u.includes("USD") && u.includes("JPY")) asset = "USDJPY";
    else if (u.includes("EUR") && u.includes("USD")) asset = "EURUSD";
  } else if (/euro\s+vs\s+us\s+dollar/i.test(raw)) asset = "EURUSD";
  else if (/pound\s+vs\s+us\s+dollar/i.test(raw)) asset = "GBPUSD";
  else if (/gold\s+vs\s+us\s+dollar/i.test(raw)) asset = "XAUUSD";
  else if (/bitcoin\s+vs\s+us\s+dollar/i.test(raw)) asset = "BTCUSD";
  else if (/us\s+dollar\s+vs\s+(japanese\s+)?yen/i.test(raw)) asset = "USDJPY";

  const ohlc = raw.match(/O\s*([0-9]+(?:\.[0-9]+)?)\s*H\s*([0-9]+(?:\.[0-9]+)?)\s*L\s*([0-9]+(?:\.[0-9]+)?)\s*C\s*([0-9]+(?:\.[0-9]+)?)/i);
  let bar = null;
  if (ohlc) {
    const open = Number(ohlc[1]);
    const high = Number(ohlc[2]);
    const low = Number(ohlc[3]);
    const close = Number(ohlc[4]);
    if (open > 0 && high > 0 && low > 0 && close > 0) {
      bar = { open, high: Math.max(high, open, close), low: Math.min(low, open, close), close };
    }
  }
  let timeframe = "";
  const title = raw.match(/(?:dollar|gold|bitcoin|yen)\s*[·•]\s*(\d{1,2})\s*[·•]/i);
  if (title) {
    const n = Number(title[1]);
    if (n === 1) timeframe = "1m";
    else if (n === 5) timeframe = "5m";
    else if (n === 15) timeframe = "15m";
    else if (n === 30) timeframe = "30m";
    else if (n === 60) timeframe = "1h";
  }
  return { asset, bar, timeframe };
}

globalThis.parseChartText = parseChartText;
