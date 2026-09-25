import { atr } from "./indicators.ts";

export interface Bar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  timeframe?: string;
}

export type Side = "BUY" | "SELL" | "WAIT";

const TF_MS: Record<string, number> = {
  "15s": 15_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
};

export interface SmcRead {
  orderBlock: string;
  fvg: string;
  liquidity: string;
  reason: string;
}

export interface MtfCell {
  label: "1H" | "15M" | "5M";
  direction: Side;
  note: string;
}

export interface MtfMatrix {
  cells: MtfCell[];
  strong: boolean;
  line: string;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function readSmc(bars: Bar[]): SmcRead {
  const empty: SmcRead = {
    orderBlock: "No order block on these closed candles.",
    fvg: "No fair value gap.",
    liquidity: "No liquidity pool.",
    reason: "No order block, fair value gap, or liquidity pool on these closed candles.",
  };
  if (bars.length < 3) return empty;
  const bodies = bars.slice(-20).map((b) => Math.abs(b.close - b.open));
  const typical = median(bodies) || Math.abs(bars[bars.length - 1]!.close) * 0.0001;
  let orderBlock = empty.orderBlock;
  for (let i = bars.length - 1; i >= 1; i -= 1) {
    const candle = bars[i]!;
    const prev = bars[i - 1]!;
    const body = Math.abs(candle.close - candle.open);
    const bull = candle.close > candle.open && body > typical * 1.5 && candle.close > prev.high;
    const bear = candle.close < candle.open && body > typical * 1.5 && candle.close < prev.low;
    if (!bull && !bear) continue;
    const side = bull ? "Bullish" : "Bearish";
    orderBlock = `${side} order block ${prev.low.toFixed(5)}–${prev.high.toFixed(5)} before the displacement candle.`;
    break;
  }
  let fvg = empty.fvg;
  for (let i = bars.length - 1; i >= 2; i -= 1) {
    const left = bars[i - 2]!;
    const right = bars[i]!;
    const bull = left.high < right.low;
    const bear = left.low > right.high;
    if (!bull && !bear) continue;
    const low = bull ? left.high : right.high;
    const high = bull ? right.low : left.low;
    const later = bars.slice(i + 1);
    const filled = later.some((b) => b.low <= high && b.high >= low);
    if (filled) continue;
    fvg = `${bull ? "Bullish" : "Bearish"} fair value gap ${low.toFixed(5)}–${high.toFixed(5)}, still open.`;
    break;
  }
  const a = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  const tol = a != null && a > 0 ? a * 0.15 : Math.abs(bars[bars.length - 1]!.close) * 0.0002;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < bars.length - 2; i += 1) {
    const b = bars[i]!;
    if (b.high >= bars[i - 1]!.high && b.high >= bars[i + 1]!.high) highs.push(b.high);
    if (b.low <= bars[i - 1]!.low && b.low <= bars[i + 1]!.low) lows.push(b.low);
  }
  let liquidity = empty.liquidity;
  const pool = (levels: number[], name: string) => {
    for (let i = levels.length - 1; i >= 1; i -= 1) {
      if (Math.abs(levels[i]! - levels[i - 1]!) <= tol) return `${name} liquidity near ${levels[i]!.toFixed(5)}.`;
    }
    return null;
  };
  liquidity = pool(highs, "Buy-side") ?? pool(lows, "Sell-side") ?? liquidity;
  const reason = [orderBlock, fvg, liquidity].join(" ");
  return { orderBlock, fvg, liquidity, reason };
}

function resample(bars: Bar[], ms: number): Bar[] | null {
  const source = TF_MS[bars[0]?.timeframe ?? "1m"] ?? 60_000;
  if (source > ms) return null;
  const grouped = new Map<number, Bar>();
  for (const bar of bars) {
    const t = Math.floor(bar.t / ms) * ms;
    const row = grouped.get(t);
    if (!row) grouped.set(t, { ...bar, t, timeframe: undefined });
    else {
      row.high = Math.max(row.high, bar.high);
      row.low = Math.min(row.low, bar.low);
      row.close = bar.close;
    }
  }
  return [...grouped.values()].sort((a, b) => a.t - b.t);
}

function bias(bars: Bar[] | null): { direction: Side; note: string } {
  if (!bars) return { direction: "WAIT", note: "finer than the feed" };
  if (bars.length < 4) return { direction: "WAIT", note: "not enough closed bars" };
  const a = atr(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), Math.min(14, bars.length - 1));
  const delta = bars[bars.length - 1]!.close - bars[bars.length - 4]!.close;
  const floor = a != null && a > 0 ? a * 0.25 : Math.abs(bars[bars.length - 1]!.close) * 0.0001;
  if (Math.abs(delta) < floor) return { direction: "WAIT", note: "inside the noise" };
  return { direction: delta > 0 ? "BUY" : "SELL", note: delta > 0 ? "higher close" : "lower close" };
}

export function timeframeMatrix(bars: Bar[]): MtfMatrix {
  const cells: MtfCell[] = [
    { label: "1H", ms: 3_600_000 },
    { label: "15M", ms: 900_000 },
    { label: "5M", ms: 300_000 },
  ].map((tf) => {
    const read = bias(resample(bars, tf.ms));
    return { label: tf.label, direction: read.direction, note: read.note };
  });
  const agreed = cells.every((c) => c.direction === "BUY") || cells.every((c) => c.direction === "SELL");
  return {
    cells,
    strong: agreed,
    line: agreed
      ? `Strong signal. 1H, 15M, and 5M all read ${cells[0]!.direction}.`
      : "Not strong. 1H, 15M, and 5M do not all agree.",
  };
}

export function riskWarning(bars: Bar[], newsWhy: string | null): { suppress: boolean; warning: string | null } {
  const notes: string[] = [];
  if (newsWhy) notes.push(newsWhy);
  if (bars.length >= 30) {
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const recent = atr(highs, lows, closes, 14);
    const olderBars = bars.slice(0, -14);
    const older = atr(olderBars.map((b) => b.high), olderBars.map((b) => b.low), olderBars.map((b) => b.close), 14);
    const last = bars[bars.length - 1]!;
    const span = last.high - last.low;
    if (recent != null && older != null && older > 0 && recent > older * 2.2) {
      notes.push(`ATR is ${(recent / older).toFixed(1)}× its baseline.`);
    } else if (recent != null && recent > 0 && span > recent * 3) {
      notes.push("The last closed candle is more than 3× ATR.");
    }
  }
  if (!notes.length) return { suppress: false, warning: null };
  return { suppress: true, warning: `High Risk - Avoid Trading. ${notes.join(" ")}` };
}
