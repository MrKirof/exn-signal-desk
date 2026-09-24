import type { Features, ModelRecord, Outcome } from "./types.ts";
import { MIN_SAMPLE } from "./constants.ts";
import {
  brierScore,
  calibrate,
  emptyModel,
  fitPlatt,
  isotonicPredict,
  pav,
  predictRaw,
  trainLogistic,
} from "./models.ts";

export function maybeTrain(opts: {
  champion: ModelRecord;
  rows: { features: Features; y: number; pRaw?: number }[];
}): { champion: ModelRecord; challenger: ModelRecord | null; rolledBack: boolean } {
  if (opts.rows.length < MIN_SAMPLE) {
    return { champion: opts.champion, challenger: null, rolledBack: false };
  }
  const split = Math.max(16, Math.floor(opts.rows.length * 0.7));
  const train = opts.rows.slice(0, split);
  const hold = opts.rows.slice(split);
  const challenger = trainLogistic(train, { lr: 0.07, epochs: 70, l2: 0.003 });
  const holdPairs = hold.map((r) => ({ p: predictRaw(challenger, r.features), y: r.y }));
  const { a, b } = fitPlatt(holdPairs.length >= 8 ? holdPairs : train.map((r) => ({ p: predictRaw(challenger, r.features), y: r.y })));
  challenger.plattA = a;
  challenger.plattB = b;
  const aggMap = new Map<string, { x: number; y: number; n: number }>();
  for (const r of train) {
    const p = predictRaw(challenger, r.features);
    const k = p.toFixed(3);
    const cur = aggMap.get(k) ?? { x: p, y: 0, n: 0 };
    cur.y += r.y;
    cur.n += 1;
    aggMap.set(k, cur);
  }
  const agg = [...aggMap.values()].map((o) => ({ x: o.x, y: o.n ? o.y / o.n : 0, n: o.n }));
  challenger.isoBlocks = pav(agg);
  challenger.calibration = "isotonic";
  const calHold = hold.map((r) => ({
    p: calibrate(challenger, predictRaw(challenger, r.features)),
    y: r.y,
  }));
  const champHold = hold.map((r) => ({
    p: calibrate(opts.champion, predictRaw(opts.champion, r.features)),
    y: r.y,
  }));
  const brierC = brierScore(calHold);
  const brierH = brierScore(champHold);
  challenger.brierHoldout = brierC;
  challenger.brierTrain = brierScore(
    train.map((r) => ({ p: calibrate(challenger, predictRaw(challenger, r.features)), y: r.y })),
  );
  const improve = brierC != null && (brierH == null || brierC < brierH - 0.002);
  if (improve) {
    challenger.champion = true;
    return { champion: challenger, challenger, rolledBack: false };
  }
  return { champion: opts.champion, challenger, rolledBack: true };
}

export function calibrationFactor(model: ModelRecord) {
  if (model.brierHoldout == null) return 0.7;
  return Math.max(0.4, Math.min(1, 1.15 - model.brierHoldout * 3));
}

export { emptyModel, isotonicPredict };
