import type { Candle, Direction, StructureInfo, StructureZone } from "./types.ts";

export function emptyStructure(): StructureInfo {
  return {
    swingHigh: 0,
    swingLow: 0,
    eq: 0,
    zone: "EQUILIBRIUM",
    bos: "NONE",
    pos: 0.5,
  };
}

function fractals(closed: Candle[], left = 2, right = 2) {
  const highs: { i: number; p: number }[] = [];
  const lows: { i: number; p: number }[] = [];
  const end = closed.length - right;
  for (let i = left; i < end; i++) {
    const h = closed[i]!.high;
    const l = closed[i]!.low;
    let isH = true;
    let isL = true;
    for (let k = 1; k <= left; k++) {
      if (closed[i - k]!.high >= h) isH = false;
      if (closed[i - k]!.low <= l) isL = false;
    }
    for (let k = 1; k <= right; k++) {
      if (closed[i + k]!.high >= h) isH = false;
      if (closed[i + k]!.low <= l) isL = false;
    }
    if (isH) highs.push({ i, p: h });
    if (isL) lows.push({ i, p: l });
  }
  return { highs, lows };
}

export function readStructure(closed: Candle[]): StructureInfo {
  if (closed.length < 12) return emptyStructure();
  const last = closed[closed.length - 1]!;
  const { highs, lows } = fractals(closed);
  const look = closed.slice(-40);
  const sh = highs.at(-1)?.p ?? Math.max(...look.map((c) => c.high));
  const sl = lows.at(-1)?.p ?? Math.min(...look.map((c) => c.low));
  const span = Math.max(sh - sl, 1e-12);
  const pos = (last.close - sl) / span;
  const zone: StructureZone = pos >= 0.62 ? "PREMIUM" : pos <= 0.38 ? "DISCOUNT" : "EQUILIBRIUM";
  const prev = closed[closed.length - 2];
  let bos: Direction | "NONE" = "NONE";
  if (prev && last.close > sh && prev.close <= sh) bos = "BUY";
  else if (prev && last.close < sl && prev.close >= sl) bos = "SELL";
  return {
    swingHigh: sh,
    swingLow: sl,
    eq: (sh + sl) / 2,
    zone,
    bos,
    pos,
  };
}

export interface PriceLevel {
  price: number;
  kind: "support" | "resistance";
}

function cluster(prices: number[], width: number): number[] {
  const sorted = prices.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev == null || Math.abs(p - prev) > width) out.push(p);
    else out[out.length - 1] = (prev + p) / 2;
  }
  return out;
}

export function readLevels(closed: Candle[]): PriceLevel[] {
  if (closed.length < 12) return [];
  const last = closed[closed.length - 1]!.close;
  const look = closed.slice(-14);
  const width = Math.max(...look.map((c) => c.high - c.low)) * 0.35 || Math.abs(last) * 0.0002;
  const { highs, lows } = fractals(closed);
  const res = cluster(
    highs.map((h) => h.p).filter((p) => p > last),
    width,
  )
    .sort((a, b) => a - b)
    .slice(0, 3);
  const sup = cluster(
    lows.map((l) => l.p).filter((p) => p < last),
    width,
  )
    .sort((a, b) => b - a)
    .slice(0, 3);
  return [
    ...sup.map((price) => ({ price, kind: "support" as const })),
    ...res.map((price) => ({ price, kind: "resistance" as const })),
  ];
}

export function structureFits(direction: Direction, s: StructureInfo): boolean {
  if (direction === "BUY") return s.zone === "DISCOUNT" || s.bos === "BUY";
  if (direction === "SELL") return s.zone === "PREMIUM" || s.bos === "SELL";
  return false;
}
