import type { BacktestReport, Candle, LabSettings, ModelRecord, NewsEvent, Outcome } from "./types.ts";
import { DEFAULT_SETTINGS, MAX_HOLD_BARS, WARMUP_BARS } from "./constants.ts";
import { normalizeBook } from "./candles.ts";
import { analyze } from "./pipeline.ts";
import { emptyModel } from "./models.ts";
import { settlePath, settleSignal } from "./settlement.ts";
import { bucketStats, groupPerf, longestLose, maxDrawdown, profitFactor, scoreOutcomes } from "./metrics.ts";
import { sizeStake } from "./risk.ts";
import { applySpread, spreadFor } from "./costs.ts";
import { atr } from "./indicators.ts";
import { isTrade } from "./actions.ts";
/** A decision at index i may see bars[0..i] only. The fill, if any, is the next bar. */
export function splitDecisionAndFill<T>(bars: T[], i: number): { seen: T[]; fill: T | undefined } {
  return { seen: bars.slice(0, i + 1), fill: bars[i + 1] };
}

export function backtest(opts: {
  candles: Candle[];
  settings?: LabSettings;
  model?: ModelRecord;
  folds?: number;
  latencyMs?: number;
}): BacktestReport {
  const settings = { ...(opts.settings ?? DEFAULT_SETTINGS), newsFilter: false, autoPaper: false };
  const model = opts.model ?? emptyModel();
  const asset = opts.candles[0]?.asset ?? "EURUSD";
  const tf = opts.candles[0]?.timeframe ?? "1m";
  const { closed } = normalizeBook(opts.candles, tf, asset);
  const news: NewsEvent[] = [];
  const outcomes: Outcome[] = [];
  const similar: { p: number; win: boolean }[] = [];
  const seen = new Set<string>();
  const blocks = new Map<string, number>();

  for (let i = WARMUP_BARS; i < closed.length - 2; i++) {
    const { seen: window, fill: next } = splitDecisionAndFill(closed, i);
    if (!next) continue;
    const last = window[window.length - 1]!;
    const a = atr(
      window.map((c) => c.high),
      window.map((c) => c.low),
      window.map((c) => c.close),
      14,
    ) ?? 0;
    const spread = spreadFor(last.asset, a);
    const { signal } = analyze({
      closed: window,
      forming: null,
      settings,
      model,
      news,
      quality: 0.95,
      sampleSize: similar.length,
      similar: {
        wr: similar.length >= 8 ? similar.filter((s) => s.win).length / similar.length : null,
        n: similar.length,
      },
      recentHit: similar.length
        ? similar.slice(-20).filter((s) => s.win).length / Math.min(20, similar.length)
        : 0.5,
      spread,
      now: last.t + 1,
    });
    if (!isTrade(signal.direction) || seen.has(signal.signalKey)) {
      const why = signal.cancelledReason || signal.reasons[0] || "No trade";
      blocks.set(why, (blocks.get(why) ?? 0) + 1);
      continue;
    }
    seen.add(signal.signalKey);
    const entry = applySpread(next.open, signal.direction, spread);
    const stop = signal.stopPrice;
    const target = signal.targetPrice;
    if (!(stop > 0) || !(target > 0)) {
      blocks.set("Signal had no stop or target", (blocks.get("Signal had no stop or target") ?? 0) + 1);
      continue;
    }
    const sized = sizeStake({
      settings,
      probability: signal.calibratedProbability,
      entry,
      stop,
      asset: signal.asset,
      calibrationFactor: 0.85,
      regimeConfidence: 0.7,
      drawdown: 0,
      sampleSize: similar.length,
    });
    if (sized.stake <= 0 || sized.blocked) {
      blocks.set(sized.blocked || "Size was zero", (blocks.get(sized.blocked || "Size was zero") ?? 0) + 1);
      continue;
    }
    const hold = closed.slice(i + 1, i + 1 + MAX_HOLD_BARS);
    const path = settlePath({
      direction: signal.direction,
      entry,
      stop,
      target,
      bars: hold,
      timeout: true,
    });
    const out = settleSignal(
      { ...signal, entryPrice: entry, stopPrice: stop, targetPrice: target },
      path,
      sized.stake,
      { automatic: true, latencyMs: opts.latencyMs ?? 80, source: "backtest", settledAt: hold[path.barsHeld - 1]?.t ?? next.t },
    );
    outcomes.push(out);
    if (out.kind !== "TIE") similar.push({ p: signal.calibratedProbability, win: out.kind === "WIN" });
  }

  const decided = outcomes.filter((o) => o.kind !== "TIE");
  const wins = decided.filter((o) => o.kind === "WIN").length;
  const losses = decided.filter((o) => o.kind === "LOSS").length;
  const ties = outcomes.length - decided.length;
  const net = outcomes.reduce((s, o) => s + o.grossProfit, 0);
  const scores = scoreOutcomes(outcomes);
  const rSum = decided.reduce((s, o) => s + o.outcomeR, 0);
  const folds = Math.max(1, opts.folds ?? 4);
  const walkForward: BacktestReport["walkForward"] = [];
  const foldSize = Math.max(1, Math.floor(outcomes.length / folds));
  for (let f = 0; f < folds; f++) {
    const slice = outcomes.slice(f * foldSize, f === folds - 1 ? undefined : (f + 1) * foldSize);
    const d = slice.filter((o) => o.kind !== "TIE");
    const sc = scoreOutcomes(slice);
    walkForward.push({
      fold: f + 1,
      wr: d.length ? d.filter((o) => o.kind === "WIN").length / d.length : 0,
      brier: sc.brier,
      pnl: slice.reduce((s, o) => s + o.grossProfit, 0),
    });
  }

  const topBlocks = [...blocks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, n]) => ({ reason, n }));
  const note = outcomes.length
    ? `${outcomes.length} closed papers on ${closed.length} bars. Fills use the next bar after the signal candle. Walk-forward rows are chronological slices of this one pass, not a refitted model. Not a proven edge.`
    : `0 trades on ${closed.length} bars. The gate refused every candle. Top reason: ${topBlocks[0]?.reason ?? "none"}.`;

  return {
    ranAt: Date.now(),
    bars: closed.length,
    trades: outcomes.length,
    wins,
    losses,
    ties,
    winRate: decided.length ? wins / decided.length : 0,
    netProfit: net,
    profitFactor: profitFactor(outcomes),
    maxDrawdown: maxDrawdown(outcomes.map((o) => o.grossProfit)),
    expectancyR: decided.length ? rSum / decided.length : 0,
    brier: scores.brier,
    logloss: scores.logloss,
    longestLose: longestLose(outcomes),
    byAsset: groupPerf(outcomes, (o) => o.asset),
    byRegime: groupPerf(outcomes, (o) => o.regime),
    byStrategy: groupPerf(outcomes, (o) => o.strategy),
    buckets: bucketStats(outcomes),
    walkForward,
    leakageSafe: true,
    note,
    blocks: topBlocks,
  };
}
