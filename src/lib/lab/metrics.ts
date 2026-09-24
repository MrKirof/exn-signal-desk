import { BUCKETS } from "./constants.ts";
import type { BucketStat, Outcome } from "./types.ts";
import { brierScore, logLoss } from "./models.ts";

export function bucketStats(outcomes: Outcome[]): BucketStat[] {
  return BUCKETS.map((b) => {
    const rows = outcomes.filter(
      (o) => o.kind !== "TIE" && o.calibratedProbability >= b.lo && o.calibratedProbability < b.hi,
    );
    const wins = rows.filter((o) => o.kind === "WIN").length;
    const n = rows.length;
    const avgEv = n ? rows.reduce((s, o) => s + o.grossProfit / Math.max(o.stake, 1e-9), 0) / n : 0;
    return { label: b.label, lo: b.lo, hi: b.hi, n, wins, winRate: n ? wins / n : 0, avgEv };
  });
}

export function groupPerf(outcomes: Outcome[], key: (o: Outcome) => string) {
  const map = new Map<string, { n: number; wins: number; pnl: number }>();
  for (const o of outcomes) {
    if (o.kind === "TIE") continue;
    const k = key(o);
    const cur = map.get(k) ?? { n: 0, wins: 0, pnl: 0 };
    cur.n += 1;
    if (o.kind === "WIN") cur.wins += 1;
    cur.pnl += o.grossProfit;
    map.set(k, cur);
  }
  const out: Record<string, { n: number; wr: number; pnl: number }> = {};
  for (const [k, v] of map) out[k] = { n: v.n, wr: v.n ? v.wins / v.n : 0, pnl: v.pnl };
  return out;
}

export function longestLose(outcomes: Outcome[]) {
  let cur = 0;
  let max = 0;
  for (const o of outcomes) {
    if (o.kind === "LOSS") {
      cur += 1;
      max = Math.max(max, cur);
    } else if (o.kind !== "TIE") cur = 0;
  }
  return max;
}

export function maxDrawdown(pnls: number[]) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const x of pnls) {
    eq += x;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return dd;
}

export function profitFactor(outcomes: Outcome[]) {
  let gp = 0;
  let gl = 0;
  for (const o of outcomes) {
    if (o.grossProfit > 0) gp += o.grossProfit;
    else gl += Math.abs(o.grossProfit);
  }
  if (!gl) return gp > 0 ? Infinity : 0;
  return gp / gl;
}

export function scoreOutcomes(outcomes: Outcome[]) {
  const rows = outcomes
    .filter((o) => o.kind !== "TIE")
    .map((o) => ({ p: o.calibratedProbability, y: o.kind === "WIN" ? 1 : 0 }));
  return { brier: brierScore(rows), logloss: logLoss(rows) };
}
