export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let out = 0;
  for (let i = 0; i < period; i++) out += values[i];
  out /= period;
  for (let i = period; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  for (let i = 0; i < period - 1; i++) out.push(NaN);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[]) {
  if (values.length < 35) return null;
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  if (e12 == null || e26 == null) return null;
  const line = e12 - e26;
  const prev12 = ema(values.slice(0, -1), 12);
  const prev26 = ema(values.slice(0, -1), 26);
  const prev = prev12 != null && prev26 != null ? prev12 - prev26 : line;
  const hist = line - prev;
  return { line, signal: prev, hist };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  let s = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    s += tr;
  }
  return s / period;
}

export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period * 2) return null;
  let plus = 0;
  let minus = 0;
  let trs = 0;
  const start = closes.length - period;
  for (let i = start; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    plus += up > dn && up > 0 ? up : 0;
    minus += dn > up && dn > 0 ? dn : 0;
    trs += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  if (trs === 0) return 0;
  const pdi = (plus / trs) * 100;
  const mdi = (minus / trs) * 100;
  const den = pdi + mdi;
  return den === 0 ? 0 : (Math.abs(pdi - mdi) / den) * 100;
}

export function bollinger(values: number[], period = 20, k = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  let v = 0;
  for (const x of slice) v += (x - mean) ** 2;
  const sd = Math.sqrt(v / period) || 1e-12;
  const last = values[values.length - 1];
  return {
    mean,
    upper: mean + k * sd,
    lower: mean - k * sd,
    width: (2 * k * sd) / mean,
    pos: (last - (mean - k * sd)) / (2 * k * sd),
    z: (last - mean) / sd,
  };
}

export function stoch(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = closes.length - period; i < closes.length; i++) {
    hi = Math.max(hi, highs[i]);
    lo = Math.min(lo, lows[i]);
  }
  const span = Math.max(hi - lo, 1e-12);
  return ((closes[closes.length - 1] - lo) / span) * 100;
}

export function cci(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
): number | null {
  if (closes.length < period) return null;
  const tp: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    tp.push((highs[i] + lows[i] + closes[i]) / 3);
  }
  const mean = tp.reduce((a, b) => a + b, 0) / period;
  const md = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / period || 1e-12;
  return (tp[tp.length - 1] - mean) / (0.015 * md);
}

export function roc(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  const prev = values[values.length - 1 - period];
  if (!prev) return null;
  return (values[values.length - 1] - prev) / prev;
}

export function vwap(highs: number[], lows: number[], closes: number[], vols: number[]) {
  const n = Math.min(closes.length, 48);
  let pv = 0;
  let v = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    const vol = Math.max(vols[i] || 1, 1e-9);
    pv += typical * vol;
    v += vol;
  }
  return v ? pv / v : closes[closes.length - 1];
}

export function percentileRank(values: number[], value: number) {
  if (!values.length) return 0.5;
  let below = 0;
  for (const x of values) if (x <= value) below += 1;
  return below / values.length;
}

export function slope(values: number[], lookback = 5): number | null {
  if (values.length < lookback + 1) return null;
  return values[values.length - 1] - values[values.length - 1 - lookback];
}

export function returns(values: number[], n: number): number {
  if (values.length < n + 1) return 0;
  const a = values[values.length - 1 - n];
  if (!a) return 0;
  return (values[values.length - 1] - a) / a;
}

/** Kaufman Efficiency Ratio: net displacement / path length. */
export function efficiencyRatio(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  const last = values[values.length - 1];
  const first = values[values.length - 1 - period];
  let path = 0;
  for (let i = values.length - period; i < values.length; i++) {
    path += Math.abs(values[i] - values[i - 1]);
  }
  if (path <= 0) return 0;
  return Math.min(1, Math.abs(last - first) / path);
}

export function ichimoku(highs: number[], lows: number[], closes: number[]) {
  const mid = (n: number) => {
    if (highs.length < n) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = highs.length - n; i < highs.length; i++) {
      hi = Math.max(hi, highs[i] ?? hi);
      lo = Math.min(lo, lows[i] ?? lo);
    }
    return (hi + lo) / 2;
  };
  const tenkan = mid(9);
  const kijun = mid(26);
  const spanB = mid(52);
  if (tenkan == null || kijun == null || spanB == null) return null;
  const spanA = (tenkan + kijun) / 2;
  const close = closes[closes.length - 1] ?? 0;
  const top = Math.max(spanA, spanB);
  const bot = Math.min(spanA, spanB);
  const cloud = close > top ? "above" : close < bot ? "below" : "inside";
  return { tenkan, kijun, spanA, spanB, cloud };
}

export function supertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  mult = 3,
): { side: "BUY" | "SELL"; line: number } | null {
  if (closes.length < period + 2) return null;
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atr += tr;
  }
  atr /= period;
  let trend: "BUY" | "SELL" = "BUY";
  let prevUpper = Number.POSITIVE_INFINITY;
  let prevLower = Number.NEGATIVE_INFINITY;
  for (let i = period; i < closes.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atr = (atr * (period - 1) + tr) / period;
    const hl2 = (highs[i] + lows[i]) / 2;
    let upper = hl2 + mult * atr;
    let lower = hl2 - mult * atr;
    if (!(upper < prevUpper || closes[i - 1] > prevUpper)) upper = prevUpper;
    if (!(lower > prevLower || closes[i - 1] < prevLower)) lower = prevLower;
    if (trend === "BUY" && closes[i] < lower) trend = "SELL";
    else if (trend === "SELL" && closes[i] > upper) trend = "BUY";
    prevUpper = upper;
    prevLower = lower;
  }
  return { side: trend, line: trend === "BUY" ? prevLower : prevUpper };
}
