import { assetMeta } from "@/lib/lab/constants";
import type { AssetId, Regime } from "@/lib/lab/types";

export function fmtPx(asset: AssetId, n: number) {
  return n.toFixed(assetMeta(asset).digits);
}

export function fmtPct(n: number, digits = 1) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

export function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function fmtTime(ts: number) {
  return new Date(ts).toISOString().slice(11, 19) + "Z";
}

export function regimeLabel(r: Regime) {
  return r.replaceAll("_", " ");
}

export function ageSec(ms: number) {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}
