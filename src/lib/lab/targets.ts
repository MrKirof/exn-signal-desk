import { atr } from "./indicators.ts";

export interface Bar {
  t?: number;
  open?: number;
  high: number;
  low: number;
  close: number;
  timeframe?: string;
}

export interface Projection {
  side: "BUY" | "SELL";
  price: number;
  atr: number;
  target1: number;
  target2: number;
  target3: number | null;
  target1Why: string;
  target2Why: string;
  target3Why: string;
}

const TF_MS: Record<string, number> = { "15s": 15_000, "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "4h": 14_400_000 };

function swings(bars: Bar[]) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < bars.length - 2; i += 1) {
    const bar = bars[i]!;
    let high = true;
    let low = true;
    for (let k = 1; k <= 2; k += 1) {
      if (bars[i - k]!.high >= bar.high || bars[i + k]!.high >= bar.high) high = false;
      if (bars[i - k]!.low <= bar.low || bars[i + k]!.low <= bar.low) low = false;
    }
    if (high) highs.push(bar.high);
    if (low) lows.push(bar.low);
  }
  return { highs, lows };
}

function cluster(levels: number[], step: number) {
  const sorted = levels.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const level of sorted) {
    const prev = out[out.length - 1];
    if (prev == null || Math.abs(level - prev) > step) out.push(level);
    else out[out.length - 1] = (prev + level) / 2;
  }
  return out;
}

function hourBlock(side: "BUY" | "SELL", price: number, bars: Bar[]): number | null {
  if (!bars[0]?.t) return null;
  const source = TF_MS[bars[0]?.timeframe ?? "1m"] ?? 60_000;
  if (source > 3_600_000) return null;
  const grouped = new Map<number, Bar>();
  for (const bar of bars) {
    if (bar.t == null) continue;
    const t = Math.floor(bar.t / 3_600_000) * 3_600_000;
    const row = grouped.get(t);
    if (!row) grouped.set(t, { ...bar, t, open: bar.open ?? bar.close });
    else {
      row.high = Math.max(row.high, bar.high);
      row.low = Math.min(row.low, bar.low);
      row.close = bar.close;
    }
  }
  const hours = [...grouped.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  if (hours.length < 4) return null;
  for (let i = hours.length - 1; i >= 1; i -= 1) {
    const candle = hours[i]!;
    const prev = hours[i - 1]!;
    const body = Math.abs(candle.close - candle.open!);
    const typical = Math.abs(candle.high - candle.low) || body;
    if (side === "BUY" && candle.close > candle.open! && body > typical * 0.6 && candle.close > prev.high && prev.high > price) return prev.high;
    if (side === "SELL" && candle.close < candle.open! && body > typical * 0.6 && candle.close < prev.low && prev.low < price) return prev.low;
  }
  return null;
}

export function trackProgress(plan: Projection, live: number): number {
  const end = plan.target3 ?? plan.target2;
  const span = end - plan.price;
  if (!Number.isFinite(live) || span === 0) return 0;
  return Math.max(0, Math.min(1, (live - plan.price) / span));
}

export function projectTargets(side: "BUY" | "SELL", price: number, bars: Bar[], pip = 0): Projection | null {
  if (!Number.isFinite(price) || price <= 0 || bars.length < 16) return null;
  const range = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  if (range == null || range <= 0) return null;
  const { highs, lows } = swings(bars);
  const step = pip > 0 ? pip * 2 : range * 0.05;
  const near = Math.max((pip > 0 ? pip : range * 0.05) * 3, range * 0.25);
  const up = side === "BUY";
  const walls = cluster(up ? highs : lows, step).filter((level) => (up ? level >= price + near && level <= price + range * 4 : level <= price - near && level >= price - range * 4));
  walls.sort((a, b) => (up ? a - b : b - a));
  const minor = walls[0] ?? null;
  const atrLevel = up ? price + range : price - range;
  const target1 = minor != null && Math.abs(minor - price) < Math.abs(atrLevel - price) ? minor : atrLevel;
  const swingLow = Math.min(...bars.slice(-20).map((b) => b.low));
  const swingHigh = Math.max(...bars.slice(-20).map((b) => b.high));
  const leg = Math.max(swingHigh - swingLow, range);
  const fib = up ? swingLow + leg * 1.618 : swingHigh - leg * 1.618;
  const savedExtreme = up ? Math.max(...bars.map((b) => b.high)) : Math.min(...bars.map((b) => b.low));
  const spanMs = bars[0]?.t != null && bars.at(-1)?.t != null ? Math.abs((bars.at(-1)!.t ?? 0) - (bars[0]!.t ?? 0)) : 0;
  const savedOk = spanMs >= 2 * 86_400_000;
  const candidates = [up ? price + range * 1.618 : price - range * 1.618, fib, ...(savedOk ? [savedExtreme] : [])].filter((level) => (up ? level > target1 + range * 0.2 : level < target1 - range * 0.2));
  candidates.sort((a, b) => (up ? a - b : b - a));
  const target2 = candidates[0] ?? (up ? target1 + range * 0.618 : target1 - range * 0.618);
  const block = hourBlock(side, price, bars);
  const target3 = block != null && (up ? block > target2 : block < target2) ? block : null;
  return {
    side,
    price,
    atr: range,
    target1,
    target2,
    target3,
    target1Why: minor != null && target1 === minor ? "Target 1 is the nearer of 1× ATR and the closest small swing." : "Target 1 is 1× ATR. No closer swing passed the wick filter.",
    target2Why: savedOk ? "Target 2 is the nearer of 1.618× ATR, the swing extension, and the high/low of the saved candles." : "Target 2 is 1.618× ATR or the last swing extension. The file does not cover two days, so no daily high is used.",
    target3Why: target3 == null ? "No 1H order block beyond target 2 in these candles." : "Target 3 is the nearest 1H order-block edge beyond target 2.",
  };
}