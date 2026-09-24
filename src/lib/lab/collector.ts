import type { AssetId, Timeframe } from "./types.ts";
import { pinLastBar, type SpotBar, type SpotSnapshot } from "./yahoo.ts";
import { periodMs } from "./candles.ts";
import { classifyQuote, type QuoteKind } from "./provenance.ts";

export const COLLECTOR_PROTOCOL = 1;

const ASSET_ALIASES: Record<string, AssetId> = {
  EURUSD: "EURUSD",
  "EUR/USD": "EURUSD",
  EURUSD_OTC: "EURUSD",
  GBPUSD: "GBPUSD",
  "GBP/USD": "GBPUSD",
  GBPUSD_OTC: "GBPUSD",
  USDJPY: "USDJPY",
  "USD/JPY": "USDJPY",
  USDJPY_OTC: "USDJPY",
  XAUUSD: "XAUUSD",
  "XAU/USD": "XAUUSD",
  GOLD: "XAUUSD",
  XAUUSD_OTC: "XAUUSD",
  BTCUSD: "BTCUSD",
  "BTC/USD": "BTCUSD",
  BITCOIN: "BTCUSD",
  BTCUSD_OTC: "BTCUSD",
};

const TF_ALIASES: Record<string, Timeframe> = {
  "15s": "15s",
  "1m": "1m",
  m1: "1m",
  "60": "1m",
  "5m": "5m",
  m5: "5m",
  "300": "5m",
  "15m": "15m",
  m15: "15m",
  "900": "15m",
  "30m": "30m",
  m30: "30m",
  "1h": "1h",
  h1: "1h",
  "3600": "1h",
};

export interface CollectorSnapshot {
  v: number;
  source: "exness-collector";
  demo?: boolean;
  at: number;
  asset: string;
  timeframe: string;
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  payout: number;
  otc: boolean;
  bars: SpotBar[];
  venue: string;
  kind: QuoteKind;
}

export type CollectorParse = { ok: true; snap: CollectorSnapshot } | { ok: false; error: string };

export function normalizeAsset(raw: string): AssetId | null {
  const key = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "/")
    .replace(/_OTC$/i, "_OTC");
  const compact = key.replace(/\//g, "");
  return ASSET_ALIASES[key] ?? ASSET_ALIASES[compact] ?? ASSET_ALIASES[`${compact}_OTC`] ?? null;
}

export function normalizeTf(raw: string | number): Timeframe {
  const s = String(raw).trim().toLowerCase();
  return TF_ALIASES[s] ?? "1m";
}

export function normalizePayout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.85;
  if (n > 1 && n <= 98) return n / 100;
  if (n > 0.5 && n <= 0.98) return n;
  return 0.85;
}

function toMs(t: number) {
  if (!(t > 0)) return 0;
  return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
}

function readBar(raw: unknown): SpotBar | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(raw) && raw.length >= 5) {
    const t = toMs(Number(raw[0]));
    const open = Number(raw[1]);
    const high = Number(raw[2]);
    const low = Number(raw[3]);
    const close = Number(raw[4]);
    if (!(t > 0) || !(open > 0) || !(close > 0)) return null;
    return { t, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume: Number(raw[5]) || 0 };
  }
  const t = toMs(Number(o.t ?? o.time ?? o.timestamp ?? o.from));
  const open = Number(o.open ?? o.o);
  const high = Number(o.high ?? o.h);
  const low = Number(o.low ?? o.l);
  const close = Number(o.close ?? o.c ?? o.price);
  if (!(t > 0) || !(open > 0) || !(close > 0)) return null;
  return {
    t,
    open,
    high: Math.max(high || close, open, close),
    low: Math.min(low || close, open, close),
    volume: Number(o.volume ?? o.v ?? 0),
    close,
  };
}

export function parseCollector(raw: unknown): CollectorParse {
  if (raw == null || typeof raw !== "object") return { ok: false, error: "not an object" };
  const o = raw as Record<string, unknown>;
  const assetRaw = String(o.asset ?? o.symbol ?? o.pair ?? "");
  const asset = normalizeAsset(assetRaw);
  if (!asset) return { ok: false, error: `unknown asset ${assetRaw || "(empty)"}` };
  const price = Number(o.price ?? o.last ?? o.close);
  if (!(price > 0)) return { ok: false, error: "missing price" };
  const barSrc = (Array.isArray(o.bars) ? o.bars : Array.isArray(o.candles) ? o.candles : []) as unknown[];
  const bars: SpotBar[] = [];
  const horizon = Date.now() + 5 * 60_000;
  for (const row of barSrc) {
    const b = readBar(row);
    if (!b) continue;
    if (b.t > horizon) continue;
    bars.push(b);
  }
  if (bars.length < 2 && !(price > 0)) return { ok: false, error: "not enough bars" };
  const bid = o.bid != null ? Number(o.bid) : null;
  const ask = o.ask != null ? Number(o.ask) : null;
  const tf = normalizeTf(String(o.timeframe ?? o.tf ?? o.period ?? "1m"));
  const pinned = pinLastBar(bars.length ? bars : [{ t: Date.now(), open: price, high: price, low: price, close: price, volume: 0 }], price);
  const venueRaw = typeof o.venue === "string" ? o.venue.trim() : "";
  const kind = classifyQuote({
    venue: venueRaw,
    source: o.source,
    demo: o.demo === true,
    provenance: o.provenance,
  });
  return {
    ok: true,
    snap: {
      v: COLLECTOR_PROTOCOL,
      source: "exness-collector",
      demo: kind === "fixture",
      at: Number(o.at) || Date.now(),
      asset,
      timeframe: tf,
      symbol: String(o.symbol ?? assetRaw ?? asset),
      price,
      bid: bid != null && bid > 0 ? bid : null,
      ask: ask != null && ask > 0 ? ask : null,
      payout: normalizePayout(o.payout),
      otc: o.otc === true || /otc/i.test(assetRaw),
      bars: pinned.slice(-400),
      venue: venueRaw || (kind === "fixture" ? "Fixture · test" : "Unverified"),
      kind,
    },
  };
}

export function collectorToSpot(snap: CollectorSnapshot): SpotSnapshot {
  const asset = normalizeAsset(snap.asset) ?? "EURUSD";
  const tf = normalizeTf(snap.timeframe);
  return {
    ok: true,
    asset,
    timeframe: tf,
    symbol: snap.symbol,
    venue: snap.venue,
    source: snap.kind === "fixture" ? "fixture" : "unverified",
    price: snap.price,
    bid: snap.bid,
    ask: snap.ask,
    bars: snap.bars,
    stale: Date.now() - snap.at > 25_000,
    marketState: snap.kind === "fixture" ? "demo" : "unverified",
    fetchedAt: Date.now(),
    latencyMs: Math.max(0, Date.now() - snap.at),
    payout: snap.payout,
    otc: snap.otc,
    demo: snap.demo,
  };
}

export function demoCollectorFromBars(opts: {
  asset: AssetId;
  timeframe: Timeframe;
  price: number;
  bid?: number | null;
  ask?: number | null;
  bars: SpotBar[];
  payout?: number;
}): CollectorSnapshot {
  const px = opts.price;
  const pip = px > 20 ? px * 0.00008 : 0.00008;
  return {
    v: COLLECTOR_PROTOCOL,
    source: "exness-collector",
    demo: true,
    at: Date.now(),
    asset: opts.asset,
    timeframe: opts.timeframe,
    symbol: opts.asset,
    price: px,
    bid: opts.bid ?? px - pip,
    ask: opts.ask ?? px + pip,
    payout: opts.payout ?? 0.85,
    otc: false,
    bars: pinLastBar(opts.bars, px),
    venue: "Fixture · test",
    kind: "fixture",
  };
}

export function ticksToBars(ticks: { t: number; price: number }[], tf: Timeframe): SpotBar[] {
  const ms = periodMs(tf);
  const buckets = new Map<number, SpotBar>();
  for (const tk of ticks) {
    if (!(tk.price > 0) || !(tk.t > 0)) continue;
    const t = Math.floor(tk.t / ms) * ms;
    const prev = buckets.get(t);
    if (!prev) {
      buckets.set(t, { t, open: tk.price, high: tk.price, low: tk.price, close: tk.price, volume: 1 });
    } else {
      prev.high = Math.max(prev.high, tk.price);
      prev.low = Math.min(prev.low, tk.price);
      prev.close = tk.price;
      prev.volume += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

export function newCollectorToken() {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `exn_${id.replace(/-/g, "").slice(0, 20)}`;
}
