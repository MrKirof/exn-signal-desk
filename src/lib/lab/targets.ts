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

export function projectTargets(side: "BUY" | "SELL", price: number, bars: Bar[], pip = 0): Projection | null {
  if (!Number.isFinite(price) || price <= 0 || bars.length < 16) return null;
  const range = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  if (range == null || range <= 0) return null;
  const { highs, lows } = swings(bars);
  const step = pip > 0 ? pip : range * 0.05;
  const near = Math.max(step * 3, range * 0.3);
  const far = range * 3;
  const zone = (levels: number[]) => {
    const sorted = levels.slice().sort((a, b) => a - b);
    const out: number[] = [];
    for (const level of sorted) {
      const prev = out[out.length - 1];
      if (prev == null || Math.abs(level - prev) > step * 2) out.push(level);
      else out[out.length - 1] = (prev + level) / 2;
    }
    return out;
  };
  if (side === "BUY") {
    const walls = zone(highs).filter((level) => level >= price + near && level <= price + far).sort((a, b) => a - b);
    const resistance = walls[0] ?? null;
    const next = walls.find((level) => resistance != null && level > resistance + near) ?? null;
    const measured = price + range * 1.618;
    const target1 = resistance ?? price + range;
    const beyond = Math.max(measured, target1 + range * 0.618);
    const target2 = next != null && next > target1 ? Math.min(next, beyond) : beyond;
    return {
      side,
      price,
      atr: range,
      target1,
      target2: target2 > target1 ? target2 : target1 + range * 0.618,
      target1Why: resistance == null ? "No resistance inside 3× ATR. Target 1 is 1× ATR." : "Target 1 is the nearest resistance inside 3× ATR. A wick closer than 3 pips is ignored.",
      target2Why: next != null ? "Target 2 stops at the next resistance, and not past 1.618× ATR." : "No second wall inside the ATR band. Target 2 is 1.618× ATR.",
    };
  }
  const walls = zone(lows).filter((level) => level <= price - near && level >= price - far).sort((a, b) => b - a);
  const support = walls[0] ?? null;
  const next = walls.find((level) => support != null && level < support - near) ?? null;
  const measured = price - range * 1.618;
  const target1 = support ?? price - range;
  const beyond = Math.min(measured, target1 - range * 0.618);
  const target2 = next != null && next < target1 ? Math.max(next, beyond) : beyond;
  return {
    side,
    price,
    atr: range,
    target1,
    target2: target2 < target1 ? target2 : target1 - range * 0.618,
    target1Why: support == null ? "No support inside 3× ATR. Target 1 is 1× ATR." : "Target 1 is the nearest support inside 3× ATR. A wick closer than 3 pips is ignored.",
    target2Why: next != null ? "Target 2 stops at the next support, and not past 1.618× ATR." : "No second wall inside the ATR band. Target 2 is 1.618× ATR.",
  };
}
