import type { AssetId, DataSource, Timeframe } from "./types.ts";
import { assetMeta } from "./constants.ts";
import { loadYahoo, pinLastBar, type SpotBar, type SpotError, type SpotSnapshot } from "./yahoo.ts";

export type { SpotBar, SpotError, SpotSnapshot } from "./yahoo.ts";
export { candlesFromSpot, pinLastBar } from "./yahoo.ts";

const KRAKEN_INTERVAL: Record<Timeframe, number> = {
  "15s": 1,
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
};

const COINBASE_GRAN: Record<Timeframe, number> = {
  "15s": 60,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 900,
  "1h": 3600,
};

const VENUE_ORDER: Record<AssetId, Array<"kraken" | "coinbase" | "yahoo">> = {
  EURUSD: ["kraken", "yahoo"],
  GBPUSD: ["kraken", "yahoo"],
  USDJPY: ["yahoo", "kraken"],
  XAUUSD: ["kraken", "yahoo"],
  BTCUSD: ["coinbase", "kraken", "yahoo"],
};

const cache = new Map<string, { at: number; body: SpotSnapshot }>();
const CACHE_MS = 1500;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; EXN-Signal-Lab/2.1)",
    },
    signal: AbortSignal.timeout(4_500),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export function parseKrakenOhlc(raw: unknown): SpotBar[] {
  const body = raw as { result?: Record<string, unknown> };
  const result = body.result ?? {};
  const key = Object.keys(result).find((k) => k !== "last");
  if (!key) return [];
  const rows = result[key];
  if (!Array.isArray(rows)) return [];
  const bars: SpotBar[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]) * 1000;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[6] ?? row[5] ?? 0);
    if (!(t > 0) || !(open > 0) || !(close > 0)) continue;
    bars.push({ t, open, high, low, close, volume });
  }
  return bars;
}

export function parseKrakenTicker(raw: unknown): { price: number; bid: number | null; ask: number | null; pair: string } | null {
  const body = raw as { result?: Record<string, { c?: string[]; b?: string[]; a?: string[] }> };
  const result = body.result ?? {};
  const pair = Object.keys(result)[0];
  if (!pair) return null;
  const q = result[pair]!;
  const price = Number(q.c?.[0]);
  const bid = q.b?.[0] != null ? Number(q.b[0]) : null;
  const ask = q.a?.[0] != null ? Number(q.a[0]) : null;
  if (!(price > 0)) return null;
  return { price, bid: bid && bid > 0 ? bid : null, ask: ask && ask > 0 ? ask : null, pair };
}

/** Coinbase: [time, low, high, open, close, volume] newest-first, seconds. */
export function parseCoinbaseCandles(raw: unknown): SpotBar[] {
  if (!Array.isArray(raw)) return [];
  const bars: SpotBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]) * 1000;
    const low = Number(row[1]);
    const high = Number(row[2]);
    const open = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5] ?? 0);
    if (!(t > 0) || !(open > 0) || !(close > 0)) continue;
    bars.push({ t, open, high, low, close, volume });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

function spreadTooWide(asset: AssetId, bid: number | null, ask: number | null) {
  if (bid == null || ask == null || !(bid > 0) || !(ask > 0) || ask < bid) return false;
  const mid = (bid + ask) / 2;
  const rel = (ask - bid) / mid;
  if (asset === "USDJPY") return ask - bid > 0.12 || rel > 0.001;
  if (asset === "XAUUSD") return rel > 0.004;
  if (asset === "BTCUSD") return rel > 0.004;
  return rel > 0.0008;
}

async function loadKraken(asset: AssetId, timeframe: Timeframe): Promise<SpotSnapshot | SpotError> {
  const meta = assetMeta(asset);
  const t0 = Date.now();
  const interval = KRAKEN_INTERVAL[timeframe];
  try {
    const [ohlcRaw, tickRaw, goldRaw] = await Promise.all([
      getJson(`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(meta.kraken)}&interval=${interval}`),
      getJson(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(meta.kraken)}`),
      asset === "XAUUSD" ? getJson("https://api.gold-api.com/price/XAU").catch(() => null) : Promise.resolve(null),
    ]);
    const bars = parseKrakenOhlc(ohlcRaw);
    const tick = parseKrakenTicker(tickRaw);
    if (bars.length < 8 || !tick) return { ok: false, error: "kraken empty" };
    if (spreadTooWide(asset, tick.bid, tick.ask)) return { ok: false, error: "kraken spread too wide" };
    let price = tick.price;
    const gold = goldRaw as { price?: number } | null;
    if (asset === "XAUUSD" && gold?.price && gold.price > 0) {
      const drift = Math.abs(gold.price - tick.price) / tick.price;
      if (drift < 0.008) price = gold.price;
    }
    const lastT = bars[bars.length - 1]!.t;
    const stale = Date.now() - lastT > 25 * 60 * 1000;
    const venue = asset === "XAUUSD" ? "Kraken PAXG ≈ XAU spot" : `Kraken ${tick.pair}`;
    return {
      ok: true,
      asset,
      timeframe,
      symbol: tick.pair,
      venue,
      source: "kraken",
      price,
      bid: tick.bid,
      ask: tick.ask,
      bars: pinLastBar(bars.slice(-400), price),
      stale,
      marketState: stale ? "last_session" : "live",
      fetchedAt: Date.now(),
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "kraken fetch failed" };
  }
}

async function loadCoinbase(asset: AssetId, timeframe: Timeframe): Promise<SpotSnapshot | SpotError> {
  const meta = assetMeta(asset);
  if (!meta.coinbase) return { ok: false, error: "no coinbase product" };
  const t0 = Date.now();
  const gran = COINBASE_GRAN[timeframe];
  try {
    const [candlesRaw, tickerRaw] = await Promise.all([
      getJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(meta.coinbase)}/candles?granularity=${gran}`),
      getJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(meta.coinbase)}/ticker`),
    ]);
    const bars = parseCoinbaseCandles(candlesRaw);
    const ticker = tickerRaw as { price?: string; bid?: string; ask?: string };
    const price = Number(ticker.price);
    const bid = ticker.bid != null ? Number(ticker.bid) : null;
    const ask = ticker.ask != null ? Number(ticker.ask) : null;
    if (bars.length < 8 || !(price > 0)) return { ok: false, error: "coinbase empty" };
    const lastT = bars[bars.length - 1]!.t;
    const stale = Date.now() - lastT > 25 * 60 * 1000;
    return {
      ok: true,
      asset,
      timeframe,
      symbol: meta.coinbase,
      venue: `Coinbase ${meta.coinbase}`,
      source: "coinbase",
      price,
      bid: bid && bid > 0 ? bid : null,
      ask: ask && ask > 0 ? ask : null,
      bars: pinLastBar(bars.slice(-400), price),
      stale,
      marketState: stale ? "last_session" : "live",
      fetchedAt: Date.now(),
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "coinbase fetch failed" };
  }
}

export async function loadSpot(asset: AssetId, timeframe: Timeframe): Promise<SpotSnapshot | SpotError> {
  const key = `${asset}|${timeframe}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const errors: string[] = [];
  for (const venue of VENUE_ORDER[asset]) {
    const snap =
      venue === "kraken"
        ? await loadKraken(asset, timeframe)
        : venue === "coinbase"
          ? await loadCoinbase(asset, timeframe)
          : await loadYahoo(asset, timeframe);
    if (snap.ok) {
      cache.set(key, { at: Date.now(), body: snap });
      return snap;
    }
    errors.push(`${venue}: ${snap.error}`);
  }
  return { ok: false, error: errors.join(" · ") || "all venues failed" };
}

export function preferredSource(asset: AssetId): DataSource {
  const v = VENUE_ORDER[asset][0];
  return v === "kraken" || v === "coinbase" || v === "yahoo" ? v : "yahoo";
}
