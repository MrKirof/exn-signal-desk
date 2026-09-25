import { atr } from "./indicators.ts";

export interface Bar {
  high: number;
  low: number;
  close: number;
}

export interface Projection {
  side: "BUY" | "SELL";
  price: number;
  atr: number;
  target1: number;
  target2: number;
  target1Why: string;
  target2Why: string;
}

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

export function projectTargets(side: "BUY" | "SELL", price: number, bars: Bar[]): Projection | null {
  if (!Number.isFinite(price) || price <= 0 || bars.length < 16) return null;
  const range = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  if (range == null || range <= 0) return null;
  const { highs, lows } = swings(bars);
  const gap = range * 0.15;
  if (side === "BUY") {
    const resistance = highs.filter((level) => level > price + gap).sort((a, b) => a - b)[0] ?? null;
    const swingLow = lows.filter((level) => level < price).sort((a, b) => b - a)[0] ?? null;
    const swingHigh = highs.filter((level) => level > (swingLow ?? price)).sort((a, b) => a - b)[0] ?? null;
    const leg = swingLow != null && swingHigh != null && swingHigh > swingLow ? swingHigh - swingLow : range;
    const fib = (swingLow ?? price - range) + leg * 1.618;
    const target1 = resistance ?? price + range;
    const target2 = Math.max(target1 + range * 0.5, price + range * 1.618, fib);
    return {
      side,
      price,
      atr: range,
      target1,
      target2,
      target1Why: resistance == null ? "No resistance above this price. Target 1 is 1× ATR." : "Target 1 is the nearest resistance above this price.",
      target2Why: "Target 2 is the farther of 1.618× ATR and the 1.618 extension of the last swing.",
    };
  }
  const support = lows.filter((level) => level < price - gap).sort((a, b) => b - a)[0] ?? null;
  const swingHigh = highs.filter((level) => level > price).sort((a, b) => a - b)[0] ?? null;
  const swingLow = lows.filter((level) => level < (swingHigh ?? price)).sort((a, b) => b - a)[0] ?? null;
  const leg = swingHigh != null && swingLow != null && swingHigh > swingLow ? swingHigh - swingLow : range;
  const fib = (swingHigh ?? price + range) - leg * 1.618;
  const target1 = support ?? price - range;
  const target2 = Math.min(target1 - range * 0.5, price - range * 1.618, fib);
  return {
    side,
    price,
    atr: range,
    target1,
    target2,
    target1Why: support == null ? "No support under this price. Target 1 is 1× ATR." : "Target 1 is the nearest support under this price.",
    target2Why: "Target 2 is the farther of 1.618× ATR and the 1.618 extension of the last swing.",
  };
}
