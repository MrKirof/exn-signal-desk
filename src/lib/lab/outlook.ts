import type { Candle, Timeframe } from "./types.ts";
import { periodMs } from "./candles.ts";
import { scanCandles } from "./candles-master.ts";
import { readLevels, type PriceLevel } from "./structure.ts";

/**
 * Short-horizon desk model. Not a forecast.
 * Vol = ATR scaled by sqrt(time). Drift = recent close slope, capped at 0.25σ.
 * Endpoint odds use a normal distribution at the horizon.
 * "First hit" is the barrier formula (stop vs target), then discounted by
 * whether σ in that window is large enough to reach a barrier.
 */

export interface HorizonOutlook {
  label: "10m" | "30m" | "1h" | "2h" | "5h";
  minutes: number;
  sigma: number;
  expectedPrice: number;
  low1: number;
  high1: number;
  low2: number;
  high2: number;
  expectedR: number;
  pPastTarget: number;
  pPastStop: number;
  pFirstTarget: number;
  pReachEither: number;
  touch: string;
  read: string;
}

export interface MarketOutlook {
  direction: "BUY" | "SELL";
  price: number;
  atr: number;
  driftPerMin: number;
  volPerMin: number;
  horizons: HorizonOutlook[];
  levels: PriceLevel[];
  candleName: string | null;
  candleAgrees: boolean | null;
  move: "up" | "down" | "flat";
  note: string;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Standard normal CDF. */
export function normCdf(z: number): number {
  const az = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * az);
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function driftPerMinute(closed: Candle[], tf: Timeframe, volPerMin: number): number {
  const n = Math.min(12, closed.length);
  if (n < 4) return 0;
  const slice = closed.slice(-n);
  const minutes = ((n - 1) * periodMs(tf)) / 60_000;
  if (minutes <= 0) return 0;
  const raw = (slice[slice.length - 1]!.close - slice[0]!.close) / minutes;
  const cap = Math.max(volPerMin, 1e-12) * 0.25;
  return clamp(raw, -cap, cap);
}

function horizon(opts: {
  label: HorizonOutlook["label"];
  minutes: number;
  price: number;
  entry: number;
  stop: number;
  target: number;
  buy: boolean;
  driftPerMin: number;
  volPerMin: number;
  levels: PriceLevel[];
}): HorizonOutlook {
  const stopDist = Math.max(Math.abs(opts.entry - opts.stop), 1e-12);
  const sigma = Math.max(opts.volPerMin * Math.sqrt(opts.minutes), stopDist * 1e-6);
  const drift = opts.driftPerMin * opts.minutes;
  const mu = opts.price + drift;
  const favorable = opts.buy ? opts.driftPerMin : -opts.driftPerMin;
  const dTarget = opts.buy ? opts.target - mu : mu - opts.target;
  const dStop = opts.buy ? mu - opts.stop : opts.stop - mu;
  const pPastTarget = clamp(1 - normCdf(dTarget / sigma), 0, 1);
  const pPastStop = clamp(normCdf(-dStop / sigma), 0, 1);
  const a = Math.max(opts.buy ? opts.target - opts.price : opts.price - opts.target, sigma * 0.05);
  const b = Math.max(opts.buy ? opts.price - opts.stop : opts.stop - opts.price, sigma * 0.05);
  const sig2 = Math.max(opts.volPerMin * opts.volPerMin, 1e-18);
  let pFirst = b / (a + b);
  if (Math.abs(favorable) > sig2 * 1e-6) {
    const k = (2 * favorable) / sig2;
    const num = 1 - Math.exp(-k * b);
    const den = 1 - Math.exp(-k * (a + b));
    if (Number.isFinite(num) && Number.isFinite(den) && Math.abs(den) > 1e-9) pFirst = num / den;
  }
  pFirst = clamp(pFirst, 0.02, 0.98);
  const pReachEither = clamp(1 - Math.exp(-(sigma * sigma) / (Math.min(a, b) * Math.min(a, b))), 0.02, 0.98);
  const expectedR = (opts.buy ? mu - opts.entry : opts.entry - mu) / stopDist;
  const outside = a > sigma * 2;
  const stopClose = b < sigma;
  const inBand = opts.levels.filter((lv) => lv.price >= mu - sigma && lv.price <= mu + sigma);
  const touch = inBand.length
    ? inBand.map((lv) => `${lv.kind === "support" ? "support" : "resistance"} ${lv.price.toPrecision(6)}`).join(", ")
    : "no support or resistance inside the usual band";
  const read = outside
    ? `${opts.label}: target is outside the usual band — too far for this window`
    : stopClose
      ? `${opts.label}: stop is inside the usual band — a stop touch is possible`
      : expectedR >= 0.05
        ? `${opts.label}: recent move still agrees with the ticket`
        : `${opts.label}: recent move is against the ticket`;
  return {
    label: opts.label,
    minutes: opts.minutes,
    sigma,
    expectedPrice: mu,
    low1: mu - sigma,
    high1: mu + sigma,
    low2: mu - 2 * sigma,
    high2: mu + 2 * sigma,
    expectedR,
    pPastTarget,
    pPastStop,
    pFirstTarget: pFirst,
    pReachEither,
    touch,
    read,
  };
}

export function projectOutlook(opts: {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  target: number;
  price: number;
  atr: number;
  timeframe: Timeframe;
  closed: Candle[];
}): MarketOutlook | null {
  if (!Number.isFinite(opts.price) || opts.price <= 0) return null;
  if (!Number.isFinite(opts.atr) || opts.atr <= 0) return null;
  const tfMin = Math.max(periodMs(opts.timeframe) / 60_000, 1 / 60);
  const volPerMin = opts.atr / Math.sqrt(tfMin);
  const drift = driftPerMinute(opts.closed, opts.timeframe, volPerMin);
  const buy = opts.direction === "BUY";
  const levels = readLevels(opts.closed);
  const scan = scanCandles(opts.closed.slice(-80), drift >= 0 ? "TREND_UP" : "TREND_DOWN");
  const best = scan.best;
  const candleAgrees = best ? best.direction === opts.direction : null;
  const move: MarketOutlook["move"] = Math.abs(drift) < volPerMin * 0.05 ? "flat" : drift > 0 ? "up" : "down";
  const base = {
    price: opts.price,
    entry: opts.entry,
    stop: opts.stop,
    target: opts.target,
    buy,
    driftPerMin: drift,
    volPerMin,
    levels,
  };
  const horizons = (
    [
      ["10m", 10],
      ["30m", 30],
      ["1h", 60],
      ["2h", 120],
      ["5h", 300],
    ] as const
  ).map(([label, minutes]) => horizon({ ...base, label, minutes }));
  return {
    direction: opts.direction,
    price: opts.price,
    atr: opts.atr,
    driftPerMin: drift,
    volPerMin,
    horizons,
    levels,
    candleName: best?.name ?? null,
    candleAgrees,
    move,
    note: "Usual band from recent candle size. Support and resistance are old swing highs and lows. Not a promise.",
  };
}
