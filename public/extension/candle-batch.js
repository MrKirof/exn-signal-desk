/** A batch of OHLC rows. Not a guess. Returns null when the shape is not candles. */
(function (root) {
  function rowOk(row) {
    if (Array.isArray(row) && row.length >= 5) {
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      return open > 0 && high > 0 && low > 0 && close > 0;
    }
    if (!row || typeof row !== "object") return false;
    const open = Number(row.open ?? row.o);
    const close = Number(row.close ?? row.c);
    return open > 0 && close > 0;
  }
  function exnCandleBatch(node) {
    if (!Array.isArray(node) || node.length < 8) return null;
    const sample = Math.min(node.length, 12);
    let hits = 0;
    for (let i = 0; i < sample; i += 1) if (rowOk(node[i])) hits += 1;
    if (hits < 8) return null;
    return node.slice(-400);
  }
  root.exnCandleBatch = exnCandleBatch;
  if (typeof module !== "undefined" && module.exports) module.exports = { exnCandleBatch };
})(typeof globalThis !== "undefined" ? globalThis : this);
