import type { Candle, Direction } from "./types.ts";
import { atr, ema, macd, rsi } from "./indicators.ts";

export interface SkillClaim {
  text: string;
  status: "Verified" | "Inferred" | "Unknown";
}

export interface SkillScan {
  score: number;
  label: string;
  pivot: number | null;
  r1: number | null;
  s1: number | null;
  rsi: number | null;
  regime: string;
  claims: SkillClaim[];
  clash: string | null;
}

function scoreWord(score: number) {
  if (score >= 6) return "Strong buy";
  if (score >= 3) return "Buy";
  if (score <= -6) return "Strong sell";
  if (score <= -3) return "Sell";
  return "Wait";
}

export function skillScan(closed: Candle[]): SkillScan {
  const empty: SkillScan = {
    score: 0,
    label: "Wait",
    pivot: null,
    r1: null,
    s1: null,
    rsi: null,
    regime: "Not enough candles",
    claims: [{ text: "Scanner needs 40 closed candles.", status: "Verified" }],
    clash: null,
  };
  if (closed.length < 40) return empty;
  const closes = closed.map((c) => c.close);
  const last = closed[closed.length - 1]!;
  const prev = closed[closed.length - 2]!;
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(closed.map((c) => c.high), closed.map((c) => c.low), closes, 14) ?? 0;
  const atrs: number[] = [];
  for (let i = 20; i < closed.length; i++) {
    const w = closed.slice(i - 14, i);
    const v = atr(w.map((c) => c.high), w.map((c) => c.low), w.map((c) => c.close), 14);
    if (v) atrs.push(v);
  }
  const atrAvg = atrs.length ? atrs.reduce((s, v) => s + v, 0) / atrs.length : a;
  const window = closes.slice(-20);
  const mean = window.reduce((s, v) => s + v, 0) / window.length;
  const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  const upper = mean + 2 * sd;
  const lower = mean - 2 * sd;
  let score = 0;
  const claims: SkillClaim[] = [];
  if (e9 != null && e21 != null) {
    if (last.close > e21 && e9 > e21) score += 2;
    else if (last.close > e21) score += 1;
    else if (last.close < e21 && e9 < e21) score -= 2;
    else score -= 1;
    claims.push({ text: `EMA 9/21 on this timeframe. 9 is ${e9 > e21 ? "above" : "below"} 21.`, status: "Verified" });
  }
  if (r != null) {
    if (r < 30) score += 2;
    else if (r < 40) score += 1;
    else if (r > 70) score -= 2;
    else if (r > 60) score -= 1;
    claims.push({ text: `RSI(14) is ${r.toFixed(1)} on this timeframe.`, status: "Verified" });
  }
  if (m) {
    score += m.hist > 0 ? 1 : m.hist < 0 ? -1 : 0;
    claims.push({ text: "MACD here is the 12/26 line against the previous bar, not a 9-period signal line.", status: "Verified" });
  }
  if (sd > 0) {
    if (last.close > upper) score += 1;
    else if (last.close < lower) score -= 1;
    claims.push({ text: "Bollinger position uses the last 20 closes of this chart.", status: "Verified" });
  }
  const vols = closed.map((c) => c.volume);
  const volOn = vols.some((v) => v > 0);
  if (!volOn) claims.push({ text: "Volume is missing on this feed, so it scores zero.", status: "Unknown" });
  else {
    const tail = vols.slice(-20);
    const vm = tail.reduce((s, v) => s + v, 0) / tail.length;
    const vs = Math.sqrt(tail.reduce((s, v) => s + (v - vm) ** 2, 0) / tail.length);
    const z = vs > 0 ? (vols[vols.length - 1]! - vm) / vs : 0;
    if (z > 1) score += last.close >= last.open ? 1 : -1;
    claims.push({ text: `Volume z-score ${z.toFixed(2)} versus the last 20 bars.`, status: "Verified" });
  }
  const pp = (prev.high + prev.low + prev.close) / 3;
  const r1 = 2 * pp - prev.low;
  const s1 = 2 * pp - prev.high;
  claims.push({ text: "Pivot, R1, and S1 use the previous closed candle. They are not a daily floor pivot.", status: "Verified" });
  let regime = "Mixed";
  if (a > atrAvg * 1.5) regime = "Volatile";
  else if (e9 != null && e21 != null && last.close > e21 && e9 > e21) regime = "Trending up";
  else if (e9 != null && e21 != null && last.close < e21 && e9 < e21) regime = "Trending down";
  else regime = "Ranging";
  claims.push({ text: "There is no separate daily or 4-hour feed. Regime is this chart only.", status: "Inferred" });
  const label = scoreWord(score);
  const clash =
    label === "Strong sell" || label === "Sell"
      ? "BUY"
      : label === "Strong buy" || label === "Buy"
        ? "SELL"
        : null;
  return { score, label, pivot: pp, r1, s1, rsi: r, regime, claims, clash };
}

export function skillClash(direction: Direction, scan: SkillScan): string | null {
  if (direction !== "BUY" && direction !== "SELL") return null;
  if (scan.clash !== direction) return null;
  return `Sanity gate rejects this ${direction}. Scanner score ${scan.score} says ${scan.label}.`;
}

export function bookRisk(rs: number[]) {
  if (rs.length < 8) {
    return { status: "Unknown" as const, why: "Fewer than 8 closed papers. No VaR yet.", var95: null, cvar: null, maxDd: null, sharpe: null };
  }
  const sorted = [...rs].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(0.05 * sorted.length));
  const var95 = sorted[cut - 1] ?? sorted[0]!;
  const tail = sorted.slice(0, cut);
  const cvar = tail.reduce((s, v) => s + v, 0) / tail.length;
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq - peak);
  }
  const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((s, v) => s + (v - mean) ** 2, 0) / rs.length);
  return {
    status: "Verified" as const,
    why: "Computed from closed paper R only. Not an annual stock Sharpe.",
    var95,
    cvar,
    maxDd,
    sharpe: sd > 0 ? mean / sd : 0,
  };
}
