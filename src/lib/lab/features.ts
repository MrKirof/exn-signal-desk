import type { Candle, Features } from "./types.ts";
import { FEATURE_VERSION } from "./constants.ts";
import {
  adx,
  atr,
  bollinger,
  cci,
  efficiencyRatio,
  ema,
  macd,
  percentileRank,
  returns,
  roc,
  rsi,
  slope,
  stoch,
  vwap,
} from "./indicators.ts";

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

export function extractFeatures(closed: Candle[], extras?: { payout?: number; newsMin?: number; recentHit?: number; timeToClose?: number }): Features | null {
  if (closed.length < 30) return null;
  const closes = closed.map((c) => c.close);
  const highs = closed.map((c) => c.high);
  const lows = closed.map((c) => c.low);
  const vols = closed.map((c) => c.volume);
  const c = last(closed);
  const p = closed[closed.length - 2];
  const range = Math.max(c.high - c.low, 1e-12);
  const body = c.close - c.open;
  const a = atr(highs, lows, closes, 14) || range;
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, Math.min(50, closes.length - 1));
  const bb = bollinger(closes, 20, 2);
  const m = macd(closes);
  const r = rsi(closes, 14) ?? 50;
  const rPrev = rsi(closes.slice(0, -3), 14) ?? r;
  const look = closed.slice(-40);
  const hi = Math.max(...look.map((x) => x.high));
  const lo = Math.min(...look.map((x) => x.low));
  const span = Math.max(hi - lo, 1e-12);
  const atrHist: number[] = [];
  for (let i = 20; i < closed.length; i++) {
    const sliceH = highs.slice(0, i + 1);
    const sliceL = lows.slice(0, i + 1);
    const sliceC = closes.slice(0, i + 1);
    const v = atr(sliceH, sliceL, sliceC, 14);
    if (v) atrHist.push(v);
  }
  const hour = new Date(c.t).getUTCHours();
  const dow = new Date(c.t).getUTCDay();
  const vw = vwap(highs, lows, closes, vols);
  const align =
    e9 != null && e21 != null && e50 != null
      ? e9 > e21 && e21 > e50
        ? 1
        : e9 < e21 && e21 < e50
          ? -1
          : 0
      : 0;
  const rsiDiv =
    closes[closes.length - 1] > closes[closes.length - 6] && r < rPrev
      ? -1
      : closes[closes.length - 1] < closes[closes.length - 6] && r > rPrev
        ? 1
        : 0;

  return {
    version: FEATURE_VERSION,
    ret1: returns(closes, 1),
    ret3: returns(closes, 3),
    ret5: returns(closes, 5),
    ret10: returns(closes, 10),
    ret20: returns(closes, 20),
    bodyRatio: body / range,
    upperWick: (c.high - Math.max(c.open, c.close)) / range,
    lowerWick: (Math.min(c.open, c.close) - c.low) / range,
    rangeAtr: range / Math.max(a, 1e-12),
    gapSize: p ? (c.open - p.close) / Math.max(a, 1e-12) : 0,
    momAccel: returns(closes, 3) - returns(closes, 8),
    distHigh: (hi - c.close) / span,
    distLow: (c.close - lo) / span,
    swing: (c.close - lo) / span,
    breakout: c.close > hi - a * 0.05 ? 1 : c.close < lo + a * 0.05 ? -1 : 0,
    rsi: r / 100,
    rsiSlope: (r - rPrev) / 100,
    rsiDiv,
    macdHist: m ? m.hist / Math.max(a, 1e-12) : 0,
    macdSlope: m ? m.hist / Math.max(a, 1e-12) : 0,
    emaDist: e21 ? (c.close - e21) / Math.max(a, 1e-12) : 0,
    emaAlign: align,
    bbPos: bb ? bb.pos : 0.5,
    bbWidth: bb ? bb.width : 0,
    atrPct: percentileRank(atrHist, a),
    adx: (adx(highs, lows, closes, 14) ?? 20) / 100,
    stoch: (stoch(highs, lows, closes, 14) ?? 50) / 100,
    cci: Math.tanh((cci(highs, lows, closes, 20) ?? 0) / 200),
    roc: roc(closes, 10) ?? 0,
    vwapDist: (c.close - vw) / Math.max(a, 1e-12),
    hour: hour / 23,
    dow: dow / 6,
    payout: extras?.payout ?? c.payout,
    otc: c.otc ? 1 : 0,
    timeToClose: extras?.timeToClose ?? 0.5,
    newsMin: extras?.newsMin ?? 1,
    recentHit: extras?.recentHit ?? 0.5,
    efficiencyRatio: efficiencyRatio(closes, 10) ?? 0.3,
    atrExpansion: atrHist.length >= 2 ? a / Math.max(atrHist[atrHist.length - 11] ?? a, 1e-12) : 1,
  };
}

export const FEATURE_KEYS: (keyof Features)[] = [
  "ret1", "ret3", "ret5", "ret10", "ret20",
  "bodyRatio", "upperWick", "lowerWick", "rangeAtr", "gapSize",
  "momAccel", "distHigh", "distLow", "swing", "breakout",
  "rsi", "rsiSlope", "rsiDiv", "macdHist", "macdSlope",
  "emaDist", "emaAlign", "bbPos", "bbWidth", "atrPct",
  "adx", "stoch", "cci", "roc", "vwapDist",
  "hour", "dow", "payout", "otc", "timeToClose", "newsMin", "recentHit",
  "efficiencyRatio", "atrExpansion",
];

export function featureVector(f: Features): number[] {
  return FEATURE_KEYS.map((k) => Number(f[k]));
}
