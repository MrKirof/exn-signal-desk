import type { AssetId, Candle, DataSource, IntegrityReport, MarketType, Timeframe } from "./types.ts";
import { TIMEFRAME_SEC, assetMeta } from "./constants.ts";

export function periodMs(tf: Timeframe) {
  return TIMEFRAME_SEC[tf] * 1000;
}

export function bucketTs(ts: number, tf: Timeframe) {
  const ms = periodMs(tf);
  return Math.floor(ts / ms) * ms;
}

export function roundPrice(asset: AssetId, px: number) {
  const d = assetMeta(asset).digits;
  const f = 10 ** d;
  return Math.round(px * f) / f;
}

export function makeCandle(partial: {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  asset: AssetId;
  timeframe: Timeframe;
  source?: DataSource;
  receivedAt?: number;
  latencyMs?: number;
  payout?: number;
  marketType?: MarketType;
  otc?: boolean;
  synthetic?: boolean;
  closed?: boolean;
}): Candle {
  const o = roundPrice(partial.asset, partial.open);
  const c = roundPrice(partial.asset, partial.close);
  let h = roundPrice(partial.asset, partial.high);
  let l = roundPrice(partial.asset, partial.low);
  h = Math.max(h, o, c);
  l = Math.min(l, o, c);
  return {
    t: partial.t,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: partial.volume ?? 1,
    asset: partial.asset,
    timeframe: partial.timeframe,
    source: partial.source ?? "simulated",
    receivedAt: partial.receivedAt ?? Date.now(),
    latencyMs: partial.latencyMs ?? 0,
    payout: partial.payout ?? 0.85,
    marketType: partial.marketType ?? "LIVE",
    otc: partial.otc ?? false,
    synthetic: partial.synthetic ?? true,
    closed: partial.closed ?? true,
  };
}

export function isAbnormalOhlc(c: Candle) {
  if (!(c.open > 0) || !(c.close > 0) || !(c.high > 0) || !(c.low > 0)) return true;
  if (c.high < c.low) return true;
  if (c.high < Math.max(c.open, c.close)) return true;
  if (c.low > Math.min(c.open, c.close)) return true;
  const range = c.high - c.low;
  const mid = (c.high + c.low) / 2;
  if (mid > 0 && range / mid > 0.12) return true;
  return false;
}

export function normalizeBook(raw: Candle[], tf: Timeframe, asset: AssetId): {
  closed: Candle[];
  forming: Candle | null;
  report: IntegrityReport;
} {
  const reasons: string[] = [];
  const seen = new Set<number>();
  const cleaned: Candle[] = [];
  let duplicates = 0;
  let outOfOrder = 0;
  let abnormalOhlc = 0;
  let lastT = 0;

  const sorted = [...raw]
    .filter((c) => c.asset === asset && c.timeframe === tf)
    .sort((a, b) => a.t - b.t);

  for (const c of sorted) {
    const t = bucketTs(c.t > 1e12 ? c.t : c.t * 1000, tf);
    if (seen.has(t)) {
      duplicates += 1;
      const prev = cleaned[cleaned.length - 1];
      if (prev && prev.t === t) {
        prev.high = Math.max(prev.high, c.high);
        prev.low = Math.min(prev.low, c.low);
        prev.close = c.close;
        prev.volume += c.volume;
      }
      continue;
    }
    if (t < lastT) {
      outOfOrder += 1;
      continue;
    }
    const n = makeCandle({ ...c, t });
    if (isAbnormalOhlc(n)) {
      abnormalOhlc += 1;
      continue;
    }
    seen.add(t);
    lastT = t;
    cleaned.push(n);
  }

  const ms = periodMs(tf);
  let gaps = 0;
  for (let i = 1; i < cleaned.length; i++) {
    const dt = cleaned[i].t - cleaned[i - 1].t;
    if (dt > ms * 1.5) gaps += Math.round(dt / ms) - 1;
  }

  const last = cleaned[cleaned.length - 1] ?? null;
  const now = Date.now();
  const forming =
    last && now - last.t < ms * 0.98 && last.closed === false
      ? last
      : last && now - last.t < ms * 0.98
        ? { ...last, closed: false }
        : null;
  const closed = forming ? cleaned.slice(0, -1) : cleaned.map((c) => ({ ...c, closed: true }));

  const missing = gaps;
  const penalty =
    duplicates * 0.02 + outOfOrder * 0.04 + gaps * 0.03 + abnormalOhlc * 0.05;
  const quality = Math.max(0.15, Math.min(1, 1 - penalty));
  if (duplicates) reasons.push("duplicate candles deduped");
  if (outOfOrder) reasons.push("out-of-order dropped");
  if (gaps) reasons.push(`${gaps} missing bars`);
  if (abnormalOhlc) reasons.push("abnormal OHLC rejected");
  if (closed.some((c) => c.synthetic)) reasons.push("synthetic/reconstructed feed");

  return {
    closed,
    forming,
    report: { duplicates, outOfOrder, gaps, abnormalOhlc, missing, quality, reasons },
  };
}

export function applyTick(forming: Candle | null, price: number, ts: number, tf: Timeframe, asset: AssetId): Candle {
  const t = bucketTs(ts, tf);
  const px = roundPrice(asset, price);
  if (!forming || forming.t !== t) {
    return makeCandle({
      t,
      open: px,
      high: px,
      low: px,
      close: px,
      volume: 1,
      asset,
      timeframe: tf,
      receivedAt: ts,
      closed: false,
      synthetic: true,
    });
  }
  return {
    ...forming,
    high: Math.max(forming.high, px),
    low: Math.min(forming.low, px),
    close: px,
    volume: forming.volume + 1,
    receivedAt: ts,
    latencyMs: Math.max(0, ts - forming.t),
    closed: false,
  };
}

export function splitClosed(candles: Candle[]): { closed: Candle[]; forming: Candle | null } {
  if (!candles.length) return { closed: [], forming: null };
  const last = candles[candles.length - 1];
  if (last.closed === false) return { closed: candles.slice(0, -1), forming: last };
  return { closed: candles, forming: null };
}

/** Complete HTF bars only — incomplete groups are dropped (no leakage). */
export function resample(closed: Candle[], factor: number): Candle[] {
  if (factor <= 1) return closed;
  const out: Candle[] = [];
  for (let i = 0; i + factor <= closed.length; i += factor) {
    const slice = closed.slice(i, i + factor);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    out.push({
      ...last,
      t: first.t,
      open: first.open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: last.close,
      volume: slice.reduce((s, c) => s + c.volume, 0),
      closed: true,
    });
  }
  return out;
}

