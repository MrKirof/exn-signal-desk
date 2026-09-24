import type { Candle, Direction, Regime, StructureInfo, Timeframe } from "./types.ts";
import { ACTION } from "./actions.ts";
import { periodMs } from "./candles.ts";
import { MAX_HOLD_BARS } from "./constants.ts";
import { rsi, ema } from "./indicators.ts";
import { structureFits } from "./structure.ts";

export type ManageAction = "HOLD" | "HOLD_FOR_MORE" | "TRAIL" | "EXIT_EARLY" | "TIME_STOP";

export interface TradeManage {
  action: ManageAction;
  headline: string;
  detail: string;
  reasons: string[];
  unrealizedR: number;
  peakR: number;
  troughR: number;
  barsHeld: number;
  remainBars: number;
  elapsedMs: number;
  remainMs: number;
  holdLabel: string;
  etaLabel: string;
  trailStop: number;
  distToTargetR: number;
  distToStopR: number;
  progress: number;
}

export function emptyManage(): TradeManage {
  return {
    action: "HOLD",
    headline: "No open ticket",
    detail: "",
    reasons: [],
    unrealizedR: 0,
    peakR: 0,
    troughR: 0,
    barsHeld: 0,
    remainBars: MAX_HOLD_BARS,
    elapsedMs: 0,
    remainMs: 0,
    holdLabel: "—",
    etaLabel: "—",
    trailStop: 0,
    distToTargetR: 0,
    distToStopR: 0,
    progress: 0,
  };
}

function fmtHold(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 90) return rem ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function manageOpen(opts: {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  price: number;
  openedAt: number;
  entryBarT: number;
  peakR: number;
  troughR: number;
  now: number;
  timeframe: Timeframe;
  closed: Candle[];
  forming: Candle | null;
  regime: Regime;
  structure: StructureInfo;
  atr: number;
}): TradeManage {
  const buy = opts.direction === ACTION.BUY;
  const stopDist = Math.abs(opts.entry - opts.stop);
  const r = stopDist > 0 ? (buy ? opts.price - opts.entry : opts.entry - opts.price) / stopDist : 0;
  const peakR = Math.max(opts.peakR, r);
  const troughR = Math.min(opts.troughR, r);
  const barsHeld = opts.closed.filter((c) => c.t > opts.entryBarT).length;
  const remainBars = Math.max(0, MAX_HOLD_BARS - barsHeld);
  const elapsedMs = Math.max(0, opts.now - opts.openedAt);
  const maxMs = MAX_HOLD_BARS * periodMs(opts.timeframe);
  const remainMs = Math.max(0, maxMs - elapsedMs);
  const distToTarget = Math.abs(opts.target - opts.price);
  const distToStop = Math.abs(opts.price - opts.stop);
  const distToTargetR = stopDist > 0 ? distToTarget / stopDist : 0;
  const distToStopR = stopDist > 0 ? distToStop / stopDist : 0;
  const span = Math.abs(opts.target - opts.stop);
  const progress = span > 0 ? Math.min(1, Math.max(0, (buy ? opts.price - opts.stop : opts.stop - opts.price) / span)) : 0;

  const closes = opts.closed.map((c) => c.close);
  const lastRsi = rsi(closes, 14);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const emaAgainst = buy ? e9 != null && e21 != null && e9 < e21 : e9 != null && e21 != null && e9 > e21;
  const rsiAgainst = lastRsi != null && (buy ? lastRsi < 42 : lastRsi > 58);
  const regimeAgainst =
    (buy && (opts.regime === "TREND_DOWN" || opts.regime === "DEAD")) ||
    (!buy && (opts.regime === "TREND_UP" || opts.regime === "DEAD"));
  const bosAgainst = opts.structure.bos !== "NONE" && opts.structure.bos !== opts.direction;
  const structOk = structureFits(opts.direction, opts.structure);
  const pace = Math.max(opts.atr * 0.28, stopDist * 0.08, 1e-12);
  const etaBars = Math.ceil(distToTarget / pace);
  const etaMs = etaBars * periodMs(opts.timeframe);
  const etaLabel = remainMs <= 0 ? "window closed" : `~${etaBars} bar${etaBars === 1 ? "" : "s"} to TP if pace holds (${fmtHold(etaMs)})`;

  let trailStop = 0;
  if (peakR >= 1.2) trailStop = buy ? opts.entry + stopDist * 0.5 : opts.entry - stopDist * 0.5;
  else if (peakR >= 0.9) trailStop = opts.entry;

  const reasons: string[] = [];
  let action: ManageAction = "HOLD";
  let headline = "Hold the plan";
  let detail = `Stop and target still valid. ${remainBars} bars / ${fmtHold(remainMs)} left in the window.`;

  if (remainBars <= 0 || remainMs <= 0) {
    action = "TIME_STOP";
    headline = "Time window used";
    detail = `Max hold is ${MAX_HOLD_BARS} bars. Flatten at mark or let the engine time-stop.`;
    reasons.push("hold window exhausted");
  } else if (r <= -0.7) {
    action = "EXIT_EARLY";
    headline = "Stop is close — cut";
    detail = `Open ${r.toFixed(2)}R. Another push against the ticket hits the stop.`;
    reasons.push("inside last 0.3R of stop");
  } else if (peakR >= 0.7 && r <= peakR - 0.55 && r < 0.35) {
    action = "EXIT_EARLY";
    headline = "Gave back open profit";
    detail = `Peak ${peakR.toFixed(2)}R now ${r.toFixed(2)}R. Book what is left rather than hope.`;
    reasons.push("MFE faded");
  } else if (bosAgainst && r < 0.5) {
    action = "EXIT_EARLY";
    headline = "Structure broke against you";
    detail = `Break of structure ${opts.structure.bos} while the ticket is ${opts.direction}.`;
    reasons.push(`BOS ${opts.structure.bos}`);
  } else if (regimeAgainst && rsiAgainst && r < 0.4) {
    action = "EXIT_EARLY";
    headline = "Tape flipped — exit";
    detail = `Regime ${opts.regime.replaceAll("_", " ")} and RSI ${lastRsi?.toFixed(0) ?? "—"} no longer match ${opts.direction}.`;
    reasons.push("regime + RSI against");
  } else if (remainBars <= 2 && r < 0.25) {
    action = "TIME_STOP";
    headline = "Window almost gone";
    detail = `Only ${remainBars} bar${remainBars === 1 ? "" : "s"} left and ${r.toFixed(2)}R. Do not stretch for the target.`;
    reasons.push("late in window, little R");
  } else if (trailStop > 0 && peakR - r >= 0.25) {
    action = "TRAIL";
    headline = "Trail the stop — lock R";
    detail = `Peak ${peakR.toFixed(2)}R. Move stop to ${trailStop === opts.entry ? "breakeven" : "0.5R lock"} so a give-back does not become a loss.`;
    reasons.push("open profit large enough to protect");
  } else if (trailStop > 0) {
    action = "TRAIL";
    headline = "Protect the runner";
    detail = `In profit ${r.toFixed(2)}R (peak ${peakR.toFixed(2)}R). Trail stop; let the rest work.`;
    reasons.push("peak ≥ 0.9R");
  } else if (r >= 0.2 && structOk && !emaAgainst && etaBars <= remainBars + 2) {
    action = "HOLD_FOR_MORE";
    headline = "Hold — more R still in play";
    detail = `Working ${r.toFixed(2)}R with ${distToTargetR.toFixed(2)}R to target. Pace says ${etaLabel}.`;
    reasons.push("thesis intact, pace can reach TP");
  } else if (r >= 0.2 && emaAgainst) {
    action = "HOLD";
    headline = "Hold, but momentum is slowing";
    detail = `Still green ${r.toFixed(2)}R, yet EMA stack is fading. Do not add. Tighten if it gives back 0.5R.`;
    reasons.push("profit but EMA against");
  } else {
    action = "HOLD";
    headline = "Hold the plan";
    detail = `${r.toFixed(2)}R open. ${fmtHold(remainMs)} left. Target is ${distToTargetR.toFixed(2)}R away.`;
    if (structOk) reasons.push("structure still fits");
    if (!regimeAgainst) reasons.push("regime not against");
  }

  if (opts.forming) {
    const bodyAgainst = buy
      ? opts.forming.close < opts.forming.open && opts.forming.close < opts.entry
      : opts.forming.close > opts.forming.open && opts.forming.close > opts.entry;
    if (bodyAgainst && action === "HOLD_FOR_MORE") {
      action = "HOLD";
      headline = "Live bar is against — wait close";
      detail = "Do not add. Let this candle finish before cutting a working ticket.";
      reasons.push("forming bar against");
    }
  }

  return {
    action,
    headline,
    detail,
    reasons: reasons.slice(0, 4),
    unrealizedR: r,
    peakR,
    troughR,
    barsHeld,
    remainBars,
    elapsedMs,
    remainMs,
    holdLabel: `${fmtHold(elapsedMs)} in · ${fmtHold(remainMs)} left`,
    etaLabel,
    trailStop,
    distToTargetR,
    distToStopR,
    progress,
  };
}
