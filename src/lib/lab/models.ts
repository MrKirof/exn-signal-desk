import { FEATURE_KEYS, featureVector } from "./features.ts";
import type { Features, ModelRecord } from "./types.ts";
import { FEATURE_VERSION, MODEL_VERSION } from "./constants.ts";

export function sigmoid(z: number) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function predictRaw(model: ModelRecord, features: Features) {
  const x = featureVector(features);
  let z = model.bias;
  const n = Math.min(model.weights.length, x.length);
  for (let i = 0; i < n; i++) z += model.weights[i] * x[i];
  return sigmoid(z);
}

export function platt(p: number, a: number, b: number) {
  return sigmoid(a * Math.log(Math.max(1e-6, p / Math.max(1e-6, 1 - p))) + b);
}

export function isotonicPredict(blocks: { lo: number; hi: number; mean: number }[], x: number) {
  if (!blocks.length) return x;
  if (x <= blocks[0].lo) return blocks[0].mean;
  if (x >= blocks[blocks.length - 1].hi) return blocks[blocks.length - 1].mean;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (x >= b.lo && x <= b.hi) return b.mean;
    const n = blocks[i + 1];
    if (n && x > b.hi && x < n.lo) {
      const span = n.lo - b.hi;
      const t = span > 0 ? (x - b.hi) / span : 0;
      return b.mean + t * (n.mean - b.mean);
    }
  }
  return blocks[blocks.length - 1].mean;
}

export function calibrate(model: ModelRecord, raw: number) {
  let p = raw;
  if (model.calibration === "platt") p = platt(raw, model.plattA, model.plattB);
  else if (model.calibration === "isotonic") p = isotonicPredict(model.isoBlocks, raw);
  return Math.max(0.08, Math.min(0.88, p));
}

export function pav(points: { x: number; y: number; n: number }[]) {
  const blocks = points
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((p) => ({ lo: p.x, hi: p.x, sum: p.y * p.n, n: p.n, mean: p.y }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].mean <= blocks[i + 1].mean + 1e-12) {
      i += 1;
      continue;
    }
    const a = blocks[i];
    const b = blocks[i + 1];
    const n = a.n + b.n;
    const merged = { lo: a.lo, hi: b.hi, sum: a.sum + b.sum, n, mean: (a.sum + b.sum) / n };
    blocks.splice(i, 2, merged);
    i = Math.max(0, i - 1);
  }
  return blocks.map(({ lo, hi, mean }) => ({ lo, hi, mean }));
}

export function trainLogistic(
  rows: { features: Features; y: number }[],
  opts?: { lr?: number; epochs?: number; l2?: number },
): ModelRecord {
  const lr = opts?.lr ?? 0.08;
  const epochs = opts?.epochs ?? 80;
  const l2 = opts?.l2 ?? 0.002;
  const dim = FEATURE_KEYS.length;
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const n = rows.length;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(dim).fill(0);
    let gb = 0;
    for (const row of rows) {
      const x = featureVector(row.features);
      let z = bias;
      for (let i = 0; i < dim; i++) z += weights[i] * x[i];
      const p = sigmoid(z);
      const err = p - row.y;
      gb += err;
      for (let i = 0; i < dim; i++) gw[i] += err * x[i];
    }
    bias -= lr * (gb / n);
    for (let i = 0; i < dim; i++) {
      const step = gw[i] / n + l2 * weights[i];
      weights[i] -= lr * Math.max(-0.5, Math.min(0.5, step));
    }
  }
  return {
    version: MODEL_VERSION,
    trainedAt: Date.now(),
    trainFrom: 0,
    trainTo: Date.now(),
    featureVersion: FEATURE_VERSION,
    assets: ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"],
    method: "logistic",
    calibration: "none",
    brierTrain: null,
    brierHoldout: null,
    loglossHoldout: null,
    weights,
    bias,
    plattA: 1,
    plattB: 0,
    isoBlocks: [],
    champion: false,
  };
}

export function fitPlatt(pairs: { p: number; y: number }[]) {
  let a = 1;
  let b = 0;
  const lr = 0.05;
  for (let e = 0; e < 60; e++) {
    let ga = 0;
    let gb = 0;
    for (const r of pairs) {
      const logit = Math.log(Math.max(1e-6, r.p / Math.max(1e-6, 1 - r.p)));
      const pred = sigmoid(a * logit + b);
      const err = pred - r.y;
      ga += err * logit;
      gb += err;
    }
    a -= lr * (ga / pairs.length);
    b -= lr * (gb / pairs.length);
  }
  return { a, b };
}

export function emptyModel(): ModelRecord {
  return {
    version: MODEL_VERSION,
    trainedAt: 0,
    trainFrom: 0,
    trainTo: 0,
    featureVersion: FEATURE_VERSION,
    assets: ["EURUSD"],
    method: "logistic",
    calibration: "none",
    brierTrain: null,
    brierHoldout: null,
    loglossHoldout: null,
    weights: new Array(FEATURE_KEYS.length).fill(0),
    bias: 0,
    plattA: 1,
    plattB: 0,
    isoBlocks: [],
    champion: true,
  };
}

export function brierScore(rows: { p: number; y: number }[]) {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) s += (r.p - r.y) ** 2;
  return s / rows.length;
}

export function logLoss(rows: { p: number; y: number }[]) {
  if (!rows.length) return null;
  let s = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, r.p));
    s += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
  }
  return s / rows.length;
}
