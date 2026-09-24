import type { AssetId, Candle, DataSource, Timeframe } from "./types.ts";
import { assetMeta } from "./constants.ts";
import { makeCandle, periodMs } from "./candles.ts";

const YAHOO_INTERVAL: Record<Timeframe, { interval: string; range: string }> = {
  "15s": { interval: "1m", range: "1d" },
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "5d" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "1mo" },
};

export interface SpotBar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SpotSnapshot {
  ok: true;
  asset: AssetId;
  timeframe: Timeframe;
  symbol: string;
  venue: string;
  source: DataSource;
  price: number;
  bid: number | null;
  ask: number | null;
  bars: SpotBar[];
  stale: boolean;
  marketState: string;
  fetchedAt: number;
  latencyMs: number;
  payout?: number;
  otc?: boolean;
  demo?: boolean;
}

export interface SpotError {
  ok: false;
  error: string;
}

export function pinLastBar(bars: SpotBar[], price: number): SpotBar[] {
  if (!bars.length || !(price > 0)) return bars;
  const out = bars.slice();
  const last = { ...out[out.length - 1]! };
  last.close = price;
  last.high = Math.max(last.high, price);
  last.low = Math.min(last.low, price);
  out[out.length - 1] = last;
  return out;
}

export function candlesFromSpot(snap: SpotSnapshot, payout: number): Candle[] {
  const ms = periodMs(snap.timeframe === "15s" ? "1m" : snap.timeframe);
  return snap.bars.map((b, i) => {
    const last = i === snap.bars.length - 1;
    const age = Date.now() - b.t;
    const forming = last && age < ms * 0.98;
    return makeCandle({
      t: b.t,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      asset: snap.asset,
      timeframe: snap.timeframe,
      source: snap.source,
      receivedAt: snap.fetchedAt,
      latencyMs: snap.latencyMs,
      payout,
      marketType: snap.otc ? "OTC" : "LIVE",
      otc: !!snap.otc,
      synthetic: snap.source === "simulated",
      closed: !forming,
    });
  });
}

export async function loadYahoo(asset: AssetId, timeframe: Timeframe): Promise<SpotSnapshot | SpotError> {
  const meta = assetMeta(asset);
  const spec = YAHOO_INTERVAL[timeframe];
  const t0 = Date.now();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.yahoo)}?interval=${spec.interval}&range=${spec.range}&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EXN-Signal-Lab/2.1)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `yahoo HTTP ${res.status}` };
    const json = (await res.json()) as {
      chart?: {
        error?: { description?: string };
        result?: {
          meta?: {
            regularMarketPrice?: number;
            regularMarketTime?: number;
            symbol?: string;
            bid?: number;
            ask?: number;
          };
          timestamp?: number[];
          indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
        }[];
      };
    };
    const err = json.chart?.error?.description;
    if (err) return { ok: false, error: err };
    const result = json.chart?.result?.[0];
    if (!result) return { ok: false, error: "empty yahoo chart" };
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    const bars: SpotBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const open = q?.open?.[i];
      const high = q?.high?.[i];
      const low = q?.low?.[i];
      const close = q?.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      if (!(open > 0) || !(close > 0)) continue;
      bars.push({
        t: ts[i]! * 1000,
        open,
        high,
        low,
        close,
        volume: q?.volume?.[i] ?? 0,
      });
    }
    if (bars.length < 8) return { ok: false, error: "yahoo not enough bars" };
    const last = bars[bars.length - 1]!;
    const price = result.meta?.regularMarketPrice ?? last.close;
    const lastT = result.meta?.regularMarketTime ? result.meta.regularMarketTime * 1000 : last.t;
    const stale = Date.now() - lastT > 25 * 60 * 1000;
    const venueNote = asset === "XAUUSD" ? "Yahoo GC=F futures (not XAU spot)" : `Yahoo ${result.meta?.symbol ?? meta.yahoo}`;
    return {
      ok: true,
      asset,
      timeframe,
      symbol: result.meta?.symbol ?? meta.yahoo,
      venue: venueNote,
      source: "yahoo",
      price,
      bid: result.meta?.bid ?? null,
      ask: result.meta?.ask ?? null,
      bars: pinLastBar(bars.slice(-400), price),
      stale,
      marketState: stale ? "last_session" : "live",
      fetchedAt: Date.now(),
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "yahoo fetch failed" };
  }
}

/** @deprecated use loadSpot from feed.ts */
export const loadSpot = loadYahoo;
