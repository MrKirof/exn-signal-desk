import type { Candle, Direction, JevAction, JevBot, JevRead, Regime } from "./types.ts";
import { atr, ichimoku, macd, rsi, supertrend } from "./indicators.ts";

export type { JevAction, JevBot, JevRead };

function hold(bots: JevBot[], note: string): JevRead {
  return { action: "HOLD", confidence: 0.5, note, bots };
}

export function readJev(
  closed: Candle[],
  regime: Regime,
  book?: { spread?: number; bid?: number | null; ask?: number | null },
): JevRead {
  const closes = closed.map((c) => c.close);
  const highs = closed.map((c) => c.high);
  const lows = closed.map((c) => c.low);
  const last = closed[closed.length - 1];
  const a = atr(highs, lows, closes, 14);
  const rsiNow = rsi(closes, 14);
  const macdNow = macd(closes);
  const cloud = ichimoku(highs, lows, closes);
  const trend = supertrend(highs, lows, closes);
  const bots: JevBot[] = [];

  let reversion: JevAction = "HOLD";
  if (rsiNow == null) bots.push({ name: "RSI", read: "Not enough bars", side: "HOLD", status: "Unknown" });
  else if (rsiNow >= 55) {
    reversion = "BUY";
    bots.push({ name: "RSI", read: rsiNow.toFixed(0), side: "BUY", status: "Inferred" });
  } else if (rsiNow <= 45) {
    reversion = "SELL";
    bots.push({ name: "RSI", read: rsiNow.toFixed(0), side: "SELL", status: "Inferred" });
  } else bots.push({ name: "RSI", read: `${rsiNow.toFixed(0)} flat`, side: "HOLD", status: "Inferred" });

  let trendSide: JevAction = "HOLD";
  const trendVotes: JevAction[] = [];
  if (!macdNow) bots.push({ name: "MACD", read: "Not enough bars", side: "HOLD", status: "Unknown" });
  else {
    const side: JevAction = macdNow.hist > 0 ? "BUY" : macdNow.hist < 0 ? "SELL" : "HOLD";
    if (side !== "HOLD") trendVotes.push(side);
    bots.push({ name: "MACD", read: `hist ${macdNow.hist.toFixed(5)}`, side, status: "Inferred" });
  }
  if (!cloud) bots.push({ name: "Ichimoku", read: "Needs 52 bars", side: "HOLD", status: "Unknown" });
  else {
    const side: JevAction =
      cloud.cloud === "above" && cloud.tenkan > cloud.kijun ? "BUY" : cloud.cloud === "below" && cloud.tenkan < cloud.kijun ? "SELL" : "HOLD";
    if (side !== "HOLD") trendVotes.push(side);
    bots.push({ name: "Ichimoku", read: cloud.cloud, side, status: "Inferred" });
  }
  if (!trend) bots.push({ name: "Supertrend", read: "Not enough bars", side: "HOLD", status: "Unknown" });
  else {
    trendVotes.push(trend.side);
    bots.push({ name: "Supertrend", read: trend.side === "BUY" ? "up" : "down", side: trend.side, status: "Inferred" });
  }
  const ups = trendVotes.filter((s) => s === "BUY").length;
  const downs = trendVotes.filter((s) => s === "SELL").length;
  if (ups > 0 && downs === 0) trendSide = "BUY";
  else if (downs > 0 && ups === 0) trendSide = "SELL";

  const bid = book?.bid ?? null;
  const ask = book?.ask ?? null;
  let flow: JevAction = "HOLD";
  let flowKnown = false;
  if (bid != null && ask != null && bid > 0 && ask > 0 && last) {
    flowKnown = true;
    const mid = (bid + ask) / 2;
    flow = last.close >= mid ? "BUY" : "SELL";
    bots.push({
      name: "Order flow",
      read: `bid ${bid} ask ${ask}. Close vs mid only. Not a real footprint.`,
      side: flow,
      status: "Inferred",
    });
  } else {
    bots.push({ name: "Order flow", read: "No bid/ask on this feed", side: "HOLD", status: "Unknown" });
  }

  const regimeSide: JevAction = regime === "TREND_UP" ? "BUY" : regime === "TREND_DOWN" ? "SELL" : "HOLD";
  const spread = book?.spread ?? 0;
  const riskBlock = a != null && spread > 0.25 * a;
  bots.push({
    name: "Risk",
    read: `${regime.replaceAll("_", " ")}. ${riskBlock ? "Spread is wide versus a normal candle." : "Spread is inside the candle."}`,
    side: "HOLD",
    status: a == null ? "Unknown" : "Verified",
  });

  if (closed.length < 52 || !last) return hold(bots, "Snapshot is not ready.");
  if (riskBlock) return hold(bots, "Risk filter: spread is too wide. No size.");
  if (regime === "TRANSITION" || regime === "MIXED") return hold(bots, "Regime is not stable. Hold.");
  if (trendSide === "HOLD") return hold(bots, "MACD, Ichimoku, and Supertrend do not agree. One trend vote.");
  if (reversion !== "HOLD" && reversion !== trendSide) return hold(bots, "RSI fights the trend read. Same candles, so hold.");
  if (flowKnown && flow !== trendSide) return hold(bots, "Bid/ask mid fights the trend read. Hold.");
  if (!flowKnown) return hold(bots, "No bid/ask. RSI, MACD, Ichimoku, and Supertrend are one price series.");
  if (regimeSide !== "HOLD" && regimeSide !== trendSide) return hold(bots, "Regime fights the trend read. Hold.");

  return {
    action: trendSide,
    confidence: 0.56,
    note: "Trend read plus the quote. Not six separate edges. Confidence stays capped.",
    bots,
  };
}

export function jevAgrees(direction: Direction, jev: JevRead): boolean {
  return jev.action === direction;
}
