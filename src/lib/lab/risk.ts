import {
  DEFAULT_STAKE_FRAC,
  HARD_STAKE_CEILING,
  KELLY_FRACTION,
  MAX_MARTINGALE_STEP,
  MAX_STAKE_FRAC,
  assetMeta,
} from "./constants.ts";
import { expectedValue } from "./ev.ts";
import type { AssetId, LabSettings, MoneyMode, RiskState } from "./types.ts";

export function emptyRisk(bankroll: number): RiskState {
  return {
    bankroll,
    peakEquity: bankroll,
    equity: bankroll,
    dailyPnl: 0,
    dailyTrades: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    progressionStep: 0,
    pauseUntil: 0,
    killed: false,
    dailyStopHit: false,
    dailyTpHit: false,
    remainingLossBudget: 20,
  };
}

/** CFD Kelly: b = winR / lossR. */
export function kellyRaw(p: number, winR = 1.6, lossR = 1) {
  const b = Math.max(0.2, winR / Math.max(1e-6, lossR));
  const q = 1 - p;
  return (b * p - q) / b;
}

export function clampStake(stake: number, bankroll: number, _base: number, maxFrac = MAX_STAKE_FRAC) {
  const bank = Math.max(1, bankroll);
  const hard = bank * Math.min(HARD_STAKE_CEILING, Math.max(DEFAULT_STAKE_FRAC, maxFrac));
  return Math.max(0, Math.min(hard, Math.round(stake * 100) / 100));
}

export function sizePosition(opts: {
  settings: LabSettings;
  equity?: number;
  entry: number;
  stop: number;
  asset: AssetId;
}): { lots: number; stake: number; riskAmount: number; warning: string | null; blocked: string | null } {
  const spec = assetMeta(opts.asset);
  const equity = Math.max(1, opts.equity ?? opts.settings.bankroll);
  const stopDist = Math.abs(opts.entry - opts.stop);
  if (!(opts.entry > 0) || stopDist < spec.minStop) {
    return { lots: 0, stake: 0, riskAmount: 0, warning: null, blocked: "stop too tight vs broker minimum" };
  }
  const riskPct = Math.min(opts.settings.maxStakeFrac, Math.max(0.0005, opts.settings.riskPercent || DEFAULT_STAKE_FRAC));
  const riskAmount = equity * riskPct;
  const perLot = stopDist * spec.valuePerPrice;
  if (perLot <= 0) return { lots: 0, stake: 0, riskAmount, warning: null, blocked: "invalid stop distance" };
  const rawLots = riskAmount / perLot;
  let lots = Math.floor(rawLots / spec.lotStep + 1e-12) * spec.lotStep;
  lots = Math.round(lots / spec.lotStep) * spec.lotStep;
  const minRisk = spec.minLot * perLot;
  if (lots + 1e-12 < spec.minLot) {
    return {
      lots: 0,
      stake: 0,
      riskAmount,
      warning: null,
      blocked: `WAIT — min ${spec.minLot} lot needs ~$${Math.ceil(minRisk / riskPct)} balance at ${(riskPct * 100).toFixed(2)}% risk`,
    };
  }
  const stake = lots * perLot;
  if (stake > riskAmount + 1e-6) {
    return { lots: 0, stake: 0, riskAmount, warning: null, blocked: "WAIT — minimum lot exceeds risk budget" };
  }
  return { lots, stake, riskAmount, warning: null, blocked: null };
}

export function sizeStake(opts: {
  settings: LabSettings;
  probability: number;
  entry: number;
  stop: number;
  asset: AssetId;
  winR?: number;
  calibrationFactor: number;
  regimeConfidence: number;
  drawdown: number;
  sampleSize: number;
  lossStreak?: number;
}): { stake: number; lots: number; preview: number[]; warning: string | null; blocked: string | null } & Omit<SizeBook, "lots" | "stake" | "warning" | "blocked"> {
  const s = opts.settings;
  const emptyExtra = { riskAmount: 0, notional: 0, leverage: 0, margin: 0, marginPct: 0, minBalance: 0, note: "" };
  const ev = expectedValue(opts.probability, opts.winR ?? 1.6, 1, 0.08);
  if (ev <= 0) return { stake: 0, lots: 0, preview: [], warning: "Non-positive EV — no trade", blocked: "Non-positive EV — no trade", ...emptyExtra };

  const equity = Math.max(1, opts.settings.bankroll);
  const spec = assetMeta(opts.asset);
  const stopDist = Math.abs(opts.entry - opts.stop);
  const perLot = stopDist * spec.valuePerPrice;
  const riskPct = Math.min(s.maxStakeFrac, Math.max(0.0005, s.riskPercent || DEFAULT_STAKE_FRAC));
  const minBalance = perLot > 0 ? Math.ceil((spec.minLot * perLot) / riskPct) : 0;

  const sized = sizePosition({
    settings: s,
    equity,
    entry: opts.entry,
    stop: opts.stop,
    asset: opts.asset,
  });
  if (sized.blocked) {
    const minLots = spec.minLot;
    const notion = notionalUsd(opts.asset, minLots, opts.entry);
    const lev = suggestLeverage(notion, Math.max(equity, minBalance || equity), s.leverageCap || 200);
    return {
      ...sized,
      preview: [],
      notional: notion,
      leverage: lev.leverage,
      margin: lev.margin,
      marginPct: lev.marginPct,
      minBalance,
      note: `Raise balance to ~$${minBalance} (or risk %) to take ${minLots} lot.`,
    };
  }

  const k = Math.max(0, kellyRaw(opts.probability, opts.winR ?? 1.6));
  const ddFactor = Math.max(0.25, 1 - Math.min(0.7, opts.drawdown * 2.2));
  const sampleFactor = opts.sampleSize >= 40 ? 1 : opts.sampleSize >= 15 ? 0.7 : 0.45;
  const calib = Math.max(0.35, Math.min(1, opts.calibrationFactor));
  let scale = calib * Math.max(0.4, opts.regimeConfidence) * ddFactor * sampleFactor;
  if ((opts.lossStreak ?? 0) >= 1) scale *= 0.5;
  if (s.moneyMode === "kelly") {
    const kRisk = Math.min(s.maxStakeFrac, Math.max(0, k * (s.kellyFraction || KELLY_FRACTION)));
    scale *= kRisk / Math.max(s.riskPercent, 1e-6);
  }
  scale = Math.min(1, Math.max(0, scale));
  let lots = Math.floor((sized.lots * scale) / spec.lotStep + 1e-12) * spec.lotStep;
  if (lots + 1e-12 < spec.minLot) {
    return {
      lots: 0,
      stake: 0,
      preview: [],
      warning: null,
      blocked: sized.blocked ?? `WAIT — min ${spec.minLot} lot needs ~$${minBalance} balance`,
      riskAmount: sized.riskAmount,
      notional: 0,
      leverage: 0,
      margin: 0,
      marginPct: 0,
      minBalance,
      note: `Raise balance to ~$${minBalance} to take the minimum lot.`,
    };
  }
  const stake = clampStake(lots * perLot, s.bankroll, s.baseStake, s.maxStakeFrac);
  const notion = notionalUsd(opts.asset, lots, opts.entry);
  const lev = suggestLeverage(notion, equity, s.leverageCap || 200);
  let warning: string | null = sized.warning;
  if (lev.marginPct > 0.35) warning = `Margin would use ${(lev.marginPct * 100).toFixed(0)}% of balance — raise cap or cut lots.`;
  if ((opts.lossStreak ?? 0) >= 1) warning = "A loss is in memory. Next stake is cut in half.";
  const preview: number[] = [];
  if (s.martingaleEnabled && (s.moneyMode === "martingale" || s.moneyMode === "anti-martingale")) {
    warning = "Martingale is quarantined. It does not create edge.";
    const steps = Math.min(MAX_MARTINGALE_STEP, s.maxSteps);
    for (let i = 0; i <= steps; i++) {
      preview.push(clampStake(s.baseStake * s.martingaleMult ** i, s.bankroll, s.baseStake, s.maxStakeFrac));
    }
  }
  const note = `${lots.toFixed(spec.lotStep < 0.01 ? 3 : 2)} lot · 1:${lev.leverage} · margin $${Math.round(lev.margin)} (${(lev.marginPct * 100).toFixed(1)}%)`;
  return {
    stake,
    lots,
    preview,
    warning,
    blocked: stake <= 0 ? "Sized to zero" : null,
    riskAmount: sized.riskAmount,
    notional: notion,
    leverage: lev.leverage,
    margin: lev.margin,
    marginPct: lev.marginPct,
    minBalance,
    note,
  };
}

export function applyOutcome(
  risk: RiskState,
  settings: LabSettings,
  won: boolean,
  tie: boolean,
  pnl: number,
  now = Date.now(),
): RiskState {
  const next: RiskState = { ...risk, equity: risk.equity + pnl, dailyPnl: risk.dailyPnl + pnl, dailyTrades: risk.dailyTrades + 1 };
  next.peakEquity = Math.max(next.peakEquity, next.equity);
  if (tie) {
    next.progressionStep = 0;
    return next;
  }
  if (won) {
    next.consecutiveWins += 1;
    next.consecutiveLosses = 0;
    next.progressionStep = 0;
  } else {
    next.consecutiveWins = 0;
    next.consecutiveLosses += 1;
    next.progressionStep = 0;
    if (next.consecutiveLosses >= settings.maxConsecutiveLosses) {
      next.pauseUntil = now + 15 * 60 * 1000;
      next.consecutiveLosses = 0;
    }
  }
  if (settings.dailyTakeProfit > 0 && next.dailyPnl >= settings.dailyTakeProfit) next.dailyTpHit = true;
  if (settings.dailyStopLoss > 0 && next.dailyPnl <= -settings.dailyStopLoss) next.dailyStopHit = true;
  next.remainingLossBudget = Math.max(0, settings.dailyStopLoss + next.dailyPnl);
  return next;
}

export function riskBlock(risk: RiskState, settings: LabSettings, now = Date.now()): string | null {
  if (risk.killed) return "Emergency kill-switch is on";
  if (risk.dailyStopHit) return "Daily stop-loss hit — controls locked";
  if (risk.dailyTpHit) return "Daily take-profit hit — session complete";
  if (risk.pauseUntil && now < risk.pauseUntil) {
    return `Consecutive-loss pause ${Math.ceil((risk.pauseUntil - now) / 1000)}s`;
  }
  if (risk.dailyTrades >= settings.maxTradesDay) return "Max trades / day reached";
  return null;
}

export function sequenceRisk(base: number, mult: number, steps: number, winR = 1.6) {
  const path: { step: number; stake: number; cumRisk: number }[] = [];
  let cum = 0;
  for (let i = 0; i <= steps; i++) {
    const stake = base * mult ** i;
    cum += stake;
    path.push({ step: i, stake, cumRisk: cum });
  }
  return { path, ruinIfAllLose: cum, winRecovers: base * winR };
}

export const LEVERAGE_STEPS = [10, 20, 30, 50, 100, 200, 400, 500, 1000, 2000] as const;

export function notionalUsd(asset: AssetId, lots: number, price: number): number {
  const spec = assetMeta(asset);
  if (!(lots > 0) || !(price > 0)) return 0;
  if (spec.usdNotional === "base") return lots * spec.contractSize;
  return lots * spec.contractSize * price;
}

export function snapLeverage(raw: number, cap: number): number {
  const limit = Math.max(1, cap || 200);
  const need = Math.max(1, raw);
  for (const step of LEVERAGE_STEPS) {
    if (step >= need && step <= limit) return step;
  }
  if (limit >= LEVERAGE_STEPS[LEVERAGE_STEPS.length - 1]!) return LEVERAGE_STEPS[LEVERAGE_STEPS.length - 1]!;
  const under = [...LEVERAGE_STEPS].reverse().find((s) => s <= limit);
  return under ?? Math.min(limit, 10);
}

/** Target ~8% of equity as used margin, then snap to a broker step under the cap. */
export function suggestLeverage(notional: number, equity: number, cap: number) {
  const eq = Math.max(1, equity);
  const targetMargin = Math.max(eq * 0.08, 1);
  const raw = notional > 0 ? notional / targetMargin : 1;
  const leverage = snapLeverage(raw, cap);
  const margin = notional > 0 ? notional / leverage : 0;
  return { leverage, margin, marginPct: margin / eq };
}

export interface SizeBook {
  lots: number;
  stake: number;
  riskAmount: number;
  notional: number;
  leverage: number;
  margin: number;
  marginPct: number;
  minBalance: number;
  warning: string | null;
  blocked: string | null;
  note: string;
}
