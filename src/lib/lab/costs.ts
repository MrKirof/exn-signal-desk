import type { AssetId, Direction } from "./types.ts";
import { assetMeta } from "./constants.ts";
import { isTrade } from "./actions.ts";

export function spreadFor(asset: AssetId, lastAtr: number) {
  const spec = assetMeta(asset);
  const wide = lastAtr > 0 ? Math.min(spec.typicalSpread * 3, lastAtr * 0.12) : spec.typicalSpread;
  return Math.max(spec.typicalSpread, wide * 0.15);
}

export function estimateCosts(opts: {
  asset: AssetId;
  entry: number;
  stop: number;
  atr: number;
  direction: Direction;
}) {
  const spec = assetMeta(opts.asset);
  const spread = spreadFor(opts.asset, opts.atr);
  const stopDist = Math.abs(opts.entry - opts.stop);
  const costR = stopDist > 0 ? spread / stopDist : 1;
  const spreadOfStop = stopDist > 0 ? spread / stopDist : 1;
  const acceptable =
    isTrade(opts.direction) &&
    stopDist >= spec.minStop &&
    spreadOfStop <= 0.1 &&
    opts.entry > 0;
  return {
    spread,
    stopDist,
    costR,
    spreadOfStop,
    acceptable,
    reason: !acceptable
      ? stopDist < spec.minStop
        ? "stop too tight vs broker minimum"
        : spreadOfStop > 0.1
          ? "spread > 10% of stop"
          : "cost model rejected"
      : null,
  };
}

export function applySpread(entry: number, direction: Direction, spread: number) {
  if (direction === "BUY") return entry + spread / 2;
  if (direction === "SELL") return entry - spread / 2;
  return entry;
}

/** Exness market order. Buy fills the ask. Sell fills the bid. */
export function exnessOpen(
  direction: Direction,
  price: number,
  bid: number | null,
  ask: number | null,
  spread: number,
) {
  if (bid != null && ask != null && bid > 0 && ask > bid) {
    if (direction === "BUY") return ask;
    if (direction === "SELL") return bid;
  }
  return applySpread(price, direction, spread);
}

/** Open buy is worth the bid. Open sell is worth the ask. */
export function exnessMark(direction: Direction, price: number, bid: number | null, ask: number | null) {
  if (bid != null && ask != null && bid > 0 && ask > bid) {
    if (direction === "BUY") return bid;
    if (direction === "SELL") return ask;
  }
  return price;
}
