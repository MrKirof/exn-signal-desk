export function meanStretch(closes: number[]) {
  const xs = closes.filter((n) => Number.isFinite(n) && n > 0);
  if (xs.length < 20) return null;
  const mean = xs.reduce((sum, n) => sum + n, 0) / xs.length;
  const variance = xs.reduce((sum, n) => sum + (n - mean) ** 2, 0) / xs.length;
  const sd = Math.sqrt(variance);
  const last = xs[xs.length - 1]!;
  if (!(sd > 0)) return { mean, z: 0, stretched: false };
  const z = (last - mean) / sd;
  return { mean, z, stretched: Math.abs(z) >= 2 };
}
