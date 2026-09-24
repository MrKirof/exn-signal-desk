import type { CandleScan, Confluence, ConfluenceItem, Direction, Regime, SessionInfo, StructureInfo } from "./types.ts";
import { structureFits } from "./structure.ts";

export function emptyConfluence(): Confluence {
  return { score: 0, max: 6, grade: "weak", items: [] };
}

export function scoreConfluence(opts: {
  direction: Direction;
  regime: Regime;
  htfBias: Direction;
  structure: StructureInfo;
  session: SessionInfo;
  newsClear: boolean;
  qualityOk: boolean;
  candle?: CandleScan;
}): Confluence {
  const d = opts.direction;
  const regimeOk =
    (d === "BUY" && (opts.regime === "TREND_UP" || opts.regime === "EXPANSION")) ||
    (d === "SELL" && (opts.regime === "TREND_DOWN" || opts.regime === "EXPANSION")) ||
    (d === "WAIT" && false) ||
    ((d === "BUY" || d === "SELL") && opts.regime === "RANGE");
  const htfOk = d !== "WAIT" && (opts.htfBias === d || opts.htfBias === "WAIT");
  const structOk = d !== "WAIT" && structureFits(d, opts.structure);
  const sessionOk = opts.session.active;
  const cleanOk = opts.newsClear && opts.qualityOk;
  const best = opts.candle?.best;
  const candleOk =
    !!best &&
    best.direction === d &&
    best.direction !== "WAIT" &&
    best.score >= 0.56 &&
    (best.role === "reversal" || best.role === "continuation");

  const items: ConfluenceItem[] = [
    { name: "Regime", ok: regimeOk, detail: opts.regime.replaceAll("_", " ") },
    { name: "HTF", ok: htfOk, detail: opts.htfBias === "WAIT" ? "no veto" : opts.htfBias },
    {
      name: "Structure",
      ok: structOk,
      detail: opts.structure.bos !== "NONE" ? `BOS ${opts.structure.bos}` : opts.structure.zone.toLowerCase(),
    },
    { name: "Session", ok: sessionOk, detail: opts.session.label },
    { name: "Tape", ok: cleanOk, detail: opts.newsClear ? "news clear" : "news blocked" },
    {
      name: "Candle",
      ok: candleOk,
      detail: best ? `${best.name} ${best.score.toFixed(2)}` : "no pattern",
    },
  ];
  const score = items.filter((x) => x.ok).length;
  const grade = score >= 5 ? "strong" : score >= 3 ? "ok" : "weak";
  return { score, max: items.length, grade, items };
}
