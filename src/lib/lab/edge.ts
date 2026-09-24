export interface EdgeRead {
  n: number;
  meanR: number;
  medianPathR: number;
  badPathR: number;
  pLose: number;
  verdict: "too few" | "no edge" | "fragile" | "holds";
  why: string;
}

function mulberry(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export function readEdge(rs: number[], paths = 400, seed = 7): EdgeRead {
  const n = rs.length;
  const meanR = n ? rs.reduce((a, r) => a + r, 0) / n : 0;
  if (n < 8) {
    return {
      n,
      meanR,
      medianPathR: meanR * n,
      badPathR: meanR * n,
      pLose: meanR < 0 ? 1 : 0,
      verdict: "too few",
      why: "Need at least 8 closed papers before a shuffled path means anything.",
    };
  }
  const rnd = mulberry(seed);
  const totals: number[] = [];
  let lose = 0;
  for (let p = 0; p < paths; p++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rs[Math.floor(rnd() * n)]!;
    totals.push(sum);
    if (sum < 0) lose++;
  }
  totals.sort((a, b) => a - b);
  const medianPathR = totals[Math.floor(paths * 0.5)]!;
  const badPathR = totals[Math.floor(paths * 0.05)]!;
  const pLose = lose / paths;
  let verdict: EdgeRead["verdict"] = "holds";
  let why = "Shuffled paths still finish up. This is still a small sample, not a promise.";
  if (n < 30) {
    verdict = "too few";
    why = "Average can look good by luck. 30 closed papers before trusting it.";
  } else if (meanR <= 0 || medianPathR <= 0) {
    verdict = "no edge";
    why = "After reshuffling your own results, the typical path does not make money.";
  } else if (pLose > 0.35 || badPathR < -3) {
    verdict = "fragile";
    why = "The average is positive, but a bad run of the same trades goes underwater.";
  }
  return { n, meanR, medianPathR, badPathR, pLose, verdict, why };
}
