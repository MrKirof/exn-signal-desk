import { MIN_EV_R, SAFETY_MARGIN, DATA_QUALITY_MIN } from "./constants.ts";

export function expectedValue(p: number, winR = 1.6, lossR = 1, costR = 0.08) {
  return p * winR - (1 - p) * lossR - costR;
}

export function breakEvenAt(winR = 1.6, lossR = 1, costR = 0.08) {
  const denom = winR + lossR;
  if (denom <= 0) return 1;
  return (lossR + costR) / denom;
}

export function gateTrade(opts: {
  calibrated: number;
  sampleSize: number;
  dataQuality: number;
  evR: number;
  minEv?: number;
  safetyMargin?: number;
  minSample?: number;
  rr: number;
  costR?: number;
}): { ok: boolean; ev: number; be: number; reasons: string[] } {
  const winR = Math.max(1.2, opts.rr || 1.6);
  const costR = opts.costR ?? 0.08;
  const ev = opts.evR;
  const be = breakEvenAt(winR, 1, costR);
  const margin = opts.safetyMargin ?? SAFETY_MARGIN;
  const minEv = opts.minEv ?? MIN_EV_R;
  const reasons: string[] = [];
  if (opts.dataQuality < DATA_QUALITY_MIN) reasons.push(`data quality ${pct(opts.dataQuality)} < ${pct(DATA_QUALITY_MIN)}`);
  if (opts.calibrated <= be + margin) reasons.push(`p ${pct(opts.calibrated)} ≤ break-even ${pct(be)} + buffer`);
  if (ev <= minEv) reasons.push(`EV ${ev.toFixed(2)}R ≤ min ${minEv}R`);
  if (opts.rr < 1.2) reasons.push(`RR ${opts.rr.toFixed(2)} < 1.2`);
  return { ok: reasons.length === 0, ev, be, reasons };
}

export function pct(n: number) {
  const sign = n > 0 && n < 0.005 ? "" : n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

export function calibrationStatus(n: number): "none" | "weak" | "usable" | "ok" {
  if (n < 30) return "none";
  if (n < 100) return "weak";
  if (n < 300) return "usable";
  return "ok";
}
