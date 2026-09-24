import { create } from "zustand";
import type {
  AssetId,
  BacktestReport,
  Candle,
  Direction,
  HealthState,
  IntegrityReport,
  LabSettings,
  Lifecycle,
  ModelRecord,
  NewsEvent,
  Outcome,
  Regime,
  RiskState,
  Signal,
  Timeframe,
  ViewId,
} from "@/lib/lab/layers/domain";
import { ASSETS, DEFAULT_SETTINGS, MAX_HOLD_BARS, MODEL_VERSION, TIMEFRAME_SEC, assetMeta, isTrade, mulberry32 } from "@/lib/lab/layers/domain";
import { bookFromSpot, candlesFromSpot, collectorToSpot, demoCollectorFromBars, generateHistory, normalizeBook, parseCollector, stepMarket, type MarketBook, type SpotSnapshot } from "@/lib/lab/layers/market";
import { analyze, atr, backtest, emptyModel, PLAYBOOK, projectOutlook, similarWinRate, type MarketMood, type MarketOutlook } from "@/lib/lab/layers/signal";
import { applyOutcome, emptyManage, emptyRisk, expectedValue, exnessMark, exnessOpen, manageOpen, mindGate, riskBlock, settlePath, settleSignal, sizeStake, spreadFor, type TradeManage } from "@/lib/lab/layers/risk";
import { audit, bucketStats, calibrationFactor, closeBookRow, groupPerf, loadCandles, loadModel, loadOperations, loadOutcomes, longestLose, maxDrawdown, maybeTrain, openBookRow, pinMemory, profitFactor, putCandles, putModel, putOperation, putOutcome, putPrediction, rememberPlaybook, scoreOutcomes, seedNews, usageEstimate, wipePersonal, type BookRow } from "@/lib/lab/layers/memory";
import { postDesk } from "@/lib/lab/layers/agents";
import { DEFAULT_HORIZON_BARS, scoreForecast } from "@/lib/lab/forecast";
import { feedClaim } from "@/lib/lab/source-label";

export interface OpenTrade {
  signal: Signal;
  stake: number;
  lots: number;
  automatic: boolean;
  entryBarT: number;
  openedAt: number;
  peakR: number;
  troughR: number;
}

export interface UniverseRow {
  asset: AssetId;
  timeframe: Timeframe;
  price: number;
  direction: Direction;
  regime: Regime;
  reason: string;
  stop: number;
  target: number;
  p: number;
  confluence: number;
  grade: "weak" | "ok" | "strong";
  pending: Direction;
}

export interface LabSnapshot {
  settings: LabSettings;
  asset: AssetId;
  timeframe: Timeframe;
  view: ViewId;
  candles: Candle[];
  forming: Candle | null;
  price: number;
  payout: number;
  signal: Signal | null;
  lifecycle: Lifecycle;
  health: HealthState;
  integrity: IntegrityReport;
  risk: RiskState;
  news: NewsEvent[];
  outcomes: Outcome[];
  bookRows: BookRow[];
  open: OpenTrade | null;
  model: ModelRecord;
  lastComputeMs: number;
  backtestReport: BacktestReport | null;
  backtestBusy: boolean;
  now: number;
  toast: string | null;
  martingaleAck: boolean;
  resetOpen: boolean;
  feedSymbol: string;
  feedVenue: string;
  feedStale: boolean;
  quoteBid: number | null;
  quoteAsk: number | null;
  collectorLive: boolean;
  collectorDemo: boolean;
  collectorToken: string;
  collectorListening: boolean;
  extensionSeen: boolean;
  universe: UniverseRow[];
  universeAt: number;
  manage: TradeManage | null;
  outlook: MarketOutlook | null;
  scanner: Signal | null;
  sizeNote: string;
  memoryTrades: number;
  memoryBytes: number;
  netOnline: boolean;
  wire: { title: string; url: string; at?: number }[];
  scanMood: MarketMood;
  scanAdv: number | null;
  scanDec: number | null;
}

interface LabActions {
  boot: () => void;
  tick: () => void;
  setAsset: (a: AssetId) => void;
  setTimeframe: (tf: Timeframe) => void;
  setView: (v: ViewId) => void;
  patchSettings: (p: Partial<LabSettings>) => void;
  paper: (manual?: boolean) => void;
  flatten: () => void;
  skip: () => void;
  toggleKill: () => void;
  requestResetRisk: () => void;
  confirmResetRisk: () => void;
  cancelResetRisk: () => void;
  runBacktest: () => void;
  exportJournal: () => string;
  wipe: () => Promise<void>;
  ackMartingale: (on: boolean) => void;
  ingestCollectorJson: (raw: unknown) => string | null;
  attachDemoCollector: () => void;
  detachCollector: () => void;
  startCollectorListen: () => void;
  stopCollectorListen: () => void;
}

let timer: number | null = null;
let book: MarketBook | null = null;
let rand = mulberry32(0xc0ffee);
let lastSignalKey = "";
let lastAsset: AssetId = "EURUSD";
let lastTf: Timeframe = "1m";
let lastPaperBar = "";
let feedMode: "kraken" | "coinbase" | "yahoo" | "exness" | "fixture" | "unverified" | "simulated" = "simulated";
let lastPoll = 0;
let pollBusy = false;
let feedSymbol = "";
let feedVenue = "";
let feedStale = false;
let feedGen = 0;
let quoteBid: number | null = null;
let quoteAsk: number | null = null;
let collectorLive = false;
let collectorDemo = false;
let collectorToken = "";
let collectorListenTimer: number | null = null;
let universeBusy = false;
let lastUniverse = 0;
let engineOn = false;
let pageHooked = false;

let lastPersist = 0;
let lastScanAt = 0;
let lastWire = 0;
let lastBreadth = 0;
let breadthBusy = false;
let wireBusy = false;
let cachedOutlook: MarketOutlook | null = null;
let cachedOutlookAt = 0;

async function pullBreadth(set: (p: Partial<LabSnapshot>) => void) {
  if (breadthBusy) return;
  breadthBusy = true;
  try {
    const res = await fetch("/api/scan");
    const json = (await res.json()) as { mood?: MarketMood; advancing?: number | null; declining?: number | null };
    set({
      scanMood: json.mood ?? "unknown",
      scanAdv: json.advancing ?? null,
      scanDec: json.declining ?? null,
    });
  } catch {
    /* keep the last breadth reading */
  } finally {
    breadthBusy = false;
  }
}

async function pullWire(set: (p: Partial<LabSnapshot>) => void, get: () => LabSnapshot) {
  if (wireBusy) return;
  lastWire = Date.now();
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    set({ netOnline: false });
    return;
  }
  wireBusy = true;
  try {
    const res = await fetch(`/api/wire?asset=${encodeURIComponent(get().asset)}`);
    const json = (await res.json()) as {
      online?: boolean;
      headlines?: { title: string; url: string; at?: number }[];
    };
    set({
      netOnline: json.online !== false,
      wire: Array.isArray(json.headlines) ? json.headlines.slice(0, 6) : get().wire,
    });
  } catch {
    set({ netOnline: typeof navigator === "undefined" ? false : navigator.onLine });
  } finally {
    wireBusy = false;
  }
}

async function hydrateMemory(
  set: (p: Partial<LabSnapshot>) => void,
  get: () => LabSnapshot & LabActions,
) {
  try {
    await pinMemory();
    void rememberPlaybook(PLAYBOOK);
    const s = get();
    const [outcomes, model, candles, bytes, bookRows] = await Promise.all([
      loadOutcomes(2000),
      loadModel(),
      loadCandles(s.asset, s.timeframe, 600),
      usageEstimate(),
      loadOperations(80),
    ]);
    const patch: Partial<LabSnapshot> = { memoryTrades: outcomes.length, memoryBytes: bytes };
    if (outcomes.length) patch.outcomes = outcomes;
    if (bookRows.length) patch.bookRows = bookRows;
    if (model && model.weights?.length) patch.model = { ...model, champion: true };
    if (!book && candles.length > 30) {
      const last = candles[candles.length - 1]!;
      book = {
        asset: s.asset,
        timeframe: s.timeframe,
        candles,
        forming: null,
        price: last.close,
        payout: s.payout || 0.85,
        marketType: "LIVE",
        otc: false,
        regime: "MIXED",
        seed: 1,
        bid: null,
        ask: null,
        venue: "memory",
      };
      patch.candles = candles;
      patch.price = last.close;
    }
    if (outcomes.length || candles.length) {
      patch.toast = `PC memory · ${outcomes.length} trades · ${candles.length} candles`;
    }
    set(patch);
  } catch {
    /* private mode or blocked storage */
  }
}

function persistTicket(open: OpenTrade | null, asset: AssetId, timeframe: Timeframe, risk: RiskState) {
  try {
    if (!open) {
      sessionStorage.removeItem("exn-open");
      postDesk({ action: "open", ticket: null });
      lastPersist = 0;
      return;
    }
    const now = Date.now();
    if (now - lastPersist < 5000) return;
    lastPersist = now;
    const slim = {
      open: {
        ...open,
        signal: {
          ...open.signal,
          features: open.signal.features,
          strategies: open.signal.strategies.map((v) => ({ ...v, reasons: v.reasons.slice(0, 2) })),
        },
      },
      asset,
      timeframe,
      risk,
      at: now,
    };
    sessionStorage.setItem("exn-open", JSON.stringify(slim));
    postDesk({ action: "open", ticket: slim });
  } catch {
    /* quota */
  }
}

async function refreshUniverse(set: (p: Partial<LabSnapshot>) => void, get: () => LabSnapshot) {
  if (universeBusy) return;
  universeBusy = true;
  lastUniverse = Date.now();
  const s = get();
  const tfs: Timeframe[] = ["1m", "5m", "15m"];
  try {
    const jobs = ASSETS.flatMap((spec) =>
      tfs.map(async (tf) => {
        try {
          const res = await fetch(`/api/market?asset=${encodeURIComponent(spec.id)}&tf=${encodeURIComponent(tf)}`);
          const json = (await res.json()) as SpotSnapshot | { ok: false; error: string };
          if (!json.ok) throw new Error("feed");
          const candles = candlesFromSpot(json, json.payout ?? 0.85);
          const { closed, report } = normalizeBook(candles, tf, spec.id);
          const spread = json.bid != null && json.ask != null ? Math.max(0, json.ask - json.bid) : undefined;
          const { signal } = analyze({
            closed,
            forming: null,
            settings: s.settings,
            model: s.model,
            news: s.news,
            quality: report.quality,
            sampleSize: 0,
            similar: { wr: null, n: 0 },
            recentHit: 0.5,
            spread,
            wire: s.wire,
          });
          const row: UniverseRow = {
            asset: spec.id,
            timeframe: tf,
            price: json.price,
            direction: signal.direction,
            regime: signal.regime,
            reason: signal.cancelledReason ?? (signal.direction !== "WAIT" ? signal.reasons[0] ?? signal.direction : "WAIT"),
            stop: signal.stopPrice,
            target: signal.targetPrice,
            p: signal.calibratedProbability,
            confluence: signal.confluence.score,
            grade: signal.confluence.grade,
            pending: signal.pendingDirection,
          };
          return row;
        } catch {
          return {
            asset: spec.id,
            timeframe: tf,
            price: 0,
            direction: "WAIT" as const,
            regime: "MIXED" as const,
            reason: "feed unavailable",
            stop: 0,
            target: 0,
            p: 0.5,
            confluence: 0,
            grade: "weak" as const,
            pending: "WAIT" as const,
          };
        }
      }),
    );
    const rows = await Promise.all(jobs);
    const prev = s.universe;
    const fresh =
      prev.length === 0
        ? []
        : rows.filter(
            (r) =>
              r.direction !== "WAIT" &&
              !prev.some((p) => p.asset === r.asset && p.timeframe === r.timeframe && p.direction === r.direction),
          );
    const toast =
      get().open || prev.length === 0
        ? undefined
        : fresh.length > 0
          ? `Setup · ${fresh.map((f) => `${f.asset} ${f.timeframe} ${f.direction}`).join(" · ")}`
          : undefined;
    set(toast ? { universe: rows, universeAt: Date.now(), toast } : { universe: rows, universeAt: Date.now() });
  } finally {
    universeBusy = false;
  }
}

function simBook(asset: AssetId, tf: Timeframe) {
  book = generateHistory({
    asset,
    timeframe: tf,
    bars: 240,
    seed: 1000 + asset.charCodeAt(0) + tf.length,
    otc: false,
  });
  rand = mulberry32(0x51ed ^ asset.charCodeAt(2));
  lastSignalKey = "";
  lastPaperBar = "";
  lastAsset = asset;
  lastTf = tf;
  feedMode = "simulated";
  feedVenue = "simulated";
  feedSymbol = asset;
  feedStale = true;
  quoteBid = null;
  quoteAsk = null;
}

function pushSim(
  set: (p: Partial<LabSnapshot>) => void,
  get: () => LabSnapshot,
  reason: string,
) {
  const s = get();
  simBook(s.asset, s.timeframe);
  if (!book) return;
  const { closed, forming, report } = normalizeBook(
    book.forming ? [...book.candles, book.forming] : book.candles,
    s.timeframe,
    s.asset,
  );
  let signal = s.signal;
  try {
    signal = analyze({
      closed,
      forming,
      settings: s.settings,
      model: s.model,
      news: s.news,
      quality: report.quality,
      sampleSize: s.outcomes.length,
      similar: { wr: null, n: s.outcomes.length },
      recentHit: 0.5,
      now: Date.now(),
      wire: s.wire,
    }).signal;
  } catch {
    /* keep the book even if the scan throws */
  }
  set({
    candles: closed,
    forming,
    price: book.price,
    payout: book.payout,
    integrity: report,
    signal,
    scanner: signal,
    feedSymbol,
    feedVenue,
    feedStale: true,
    quoteBid: null,
    quoteAsk: null,
    toast: reason,
    lifecycle: signal?.lifecycle ?? (closed.length >= 60 ? "ANALYZING" : "COLLECTING"),
    health: {
      ...s.health,
      connected: true,
      lastCandleAt: Date.now(),
      interval: s.timeframe,
      asset: s.asset,
      payout: book.payout,
      payoutAt: Date.now(),
      source: "simulated",
      modelLoaded: true,
      missing: report.missing,
      duplicates: report.duplicates,
      outOfOrder: report.outOfOrder,
    },
  });
}

async function loadSpotFeed(get: () => LabSnapshot & LabActions, gen: number) {
  if (collectorLive) return null;
  const s = get();
  pollBusy = true;
  lastPoll = Date.now();
  try {
    const res = await fetch(`/api/market?asset=${encodeURIComponent(s.asset)}&tf=${encodeURIComponent(s.timeframe)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as SpotSnapshot | { ok: false; error: string };
    if (gen !== feedGen) return null;
    if (!json.ok) throw new Error(json.error);
    const candles = candlesFromSpot(json, json.payout ?? book?.payout ?? 0.85);
    const incoming = bookFromSpot(candles, {
      asset: s.asset,
      timeframe: s.timeframe,
      price: json.price,
      payout: json.payout ?? book?.payout ?? 0.85,
      bid: json.bid,
      ask: json.ask,
      venue: json.venue,
    });
    const liveAlready =
      feedMode !== "simulated" && book && book.asset === s.asset && book.timeframe === s.timeframe && book.candles.length > 40;
    if (liveAlready && book) {
      const byT = new Map(book.candles.map((c) => [c.t, c]));
      for (const c of incoming.candles) byT.set(c.t, c);
      const merged = [...byT.values()].sort((a, b) => a.t - b.t).slice(-800);
      book = { ...incoming, candles: merged, forming: incoming.forming };
    } else {
      book = incoming;
    }
    feedMode = json.source === "kraken" || json.source === "coinbase" || json.source === "yahoo" ? json.source : "yahoo";
    feedSymbol = json.symbol;
    feedVenue = json.venue;
    feedStale = json.stale;
    quoteBid = json.bid;
    quoteAsk = json.ask;
    lastAsset = s.asset;
    lastTf = s.timeframe;
    return json;
  } finally {
    if (gen === feedGen) pollBusy = false;
  }
}

function applyIncoming(
  set: (p: Partial<LabSnapshot>) => void,
  get: () => LabSnapshot,
  snap: SpotSnapshot,
  toast: string,
  quiet = false,
) {
  if (!book) return;
  const { closed, forming, report } = normalizeBook(
    book.forming ? [...book.candles, book.forming] : book.candles,
    get().timeframe,
    get().asset,
  );
  set({
    asset: snap.asset,
    timeframe: snap.timeframe,
    candles: closed,
    forming,
    price: book.price,
    payout: book.payout,
    integrity: report,
    feedSymbol,
    feedVenue,
    feedStale,
    quoteBid,
    quoteAsk,
    collectorLive,
    collectorDemo,
    ...(quiet ? {} : { toast }),
    health: {
      connected: true,
      lastCandleAt: Date.now(),
      interval: snap.timeframe,
      missing: report.missing,
      duplicates: report.duplicates,
      outOfOrder: report.outOfOrder,
      modelLoaded: true,
      workerLatencyMs: 0,
      newsFreshAt: get().news[0]?.t ?? Date.now(),
      asset: snap.asset,
      payout: book.payout,
      payoutAt: Date.now(),
      source: feedMode,
    },
  });
}

function adoptCollector(set: (p: Partial<LabSnapshot>) => void, get: () => LabSnapshot, raw: unknown) {
  const parsed = parseCollector(raw);
  if (!parsed.ok) return parsed.error;
  const partial = typeof raw === "object" && raw != null && (raw as { partial?: boolean }).partial === true;
  const snap = collectorToSpot(parsed.snap);
  feedMode = snap.source === "fixture" ? "fixture" : "unverified";
  feedVenue = snap.venue;
  const same = !!book && book.asset === snap.asset && book.timeframe === snap.timeframe && collectorLive;
  if (partial && same && book) {
    book.price = snap.price;
    quoteBid = snap.bid;
    quoteAsk = snap.ask;
    const last = snap.bars.at(-1);
    if (!book.forming) {
      /* fall through to a full chart sync below */
    } else if (last && last.t === book.forming.t) {
      book.forming = {
        ...book.forming,
        close: snap.price,
        high: Math.max(book.forming.high, snap.price, last.high),
        low: Math.min(book.forming.low, snap.price, last.low),
        receivedAt: Date.now(),
      };
      set({
        price: snap.price,
        quoteBid: snap.bid,
        quoteAsk: snap.ask,
        forming: book.forming,
        collectorLive: true,
        collectorDemo: snap.source === "fixture",
        health: { ...get().health, source: feedMode },
        now: Date.now(),
      });
      return null;
    } else if (last) {
      book.forming = {
        ...book.forming,
        t: last.t,
        open: last.open,
        high: Math.max(last.high, snap.price),
        low: Math.min(last.low, snap.price),
        close: snap.price,
        volume: last.volume,
        receivedAt: Date.now(),
        closed: false,
      };
      set({
        price: snap.price,
        quoteBid: snap.bid,
        quoteAsk: snap.ask,
        forming: book.forming,
        collectorLive: true,
        collectorDemo: snap.source === "fixture",
        health: { ...get().health, source: feedMode },
        now: Date.now(),
      });
      return null;
    } else {
      set({
        price: snap.price,
        quoteBid: snap.bid,
        quoteAsk: snap.ask,
        collectorLive: true,
        health: { ...get().health, source: feedMode },
        now: Date.now(),
      });
      return null;
    }
  }
  if (!collectorLive) feedGen += 1;
  const switched = !book || book.asset !== snap.asset || book.timeframe !== snap.timeframe;
  const candles = candlesFromSpot(snap, snap.payout ?? 0.85);
  book = bookFromSpot(candles, {
    asset: snap.asset,
    timeframe: snap.timeframe,
    price: snap.price,
    payout: snap.payout ?? 0.85,
    bid: snap.bid,
    ask: snap.ask,
    venue: snap.venue,
  });
  collectorLive = true;
  collectorDemo = snap.source === "fixture";
  feedSymbol = snap.symbol;
  feedVenue = snap.venue;
  feedStale = snap.stale;
  quoteBid = snap.bid;
  quoteAsk = snap.ask;
  lastAsset = snap.asset;
  lastTf = snap.timeframe;
  if (switched) {
    lastSignalKey = "";
    lastPaperBar = "";
  }
  applyIncoming(
    set,
    get,
    snap,
    switched ? (snap.source === "fixture" ? `Fixture test ${snap.price}` : `Unverified quote ${snap.symbol} ${snap.price}`) : "",
    !switched,
  );
  return null;
}

function sizeFor(s: LabSnapshot, sig: Signal) {
  const stopDist = Math.abs(sig.entryPrice - sig.stopPrice);
  const rr = stopDist > 0 ? Math.abs(sig.targetPrice - sig.entryPrice) / stopDist : 1.6;
  return sizeStake({
    settings: { ...s.settings, bankroll: Math.max(10, s.risk.equity || s.settings.bankroll) },
    probability: sig.calibratedProbability,
    entry: sig.entryPrice,
    stop: sig.stopPrice,
    asset: sig.asset,
    winR: rr,
    calibrationFactor: calibrationFactor(s.model),
    regimeConfidence: sig.calibratedProbability > 0.55 ? 0.75 : 0.4,
    drawdown: s.risk.peakEquity > 0 ? (s.risk.peakEquity - s.risk.equity) / s.risk.peakEquity : 0,
    sampleSize: s.outcomes.length,
    lossStreak: s.risk.consecutiveLosses,
  });
}

const SEEDED_END = 1_700_000_000_000;
const seeded = generateHistory({
  asset: "GBPUSD",
  timeframe: "5m",
  bars: 180,
  seed: 1067,
  endTs: SEEDED_END,
});

export const useLab = create<LabSnapshot & LabActions>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  asset: "GBPUSD",
  timeframe: "5m",
  view: "desk",
  candles: seeded.candles,
  forming: null,
  price: seeded.price,
  payout: 0.87,
  signal: null,
  lifecycle: "ANALYZING",
  health: {
    connected: true,
    lastCandleAt: SEEDED_END,
    interval: "5m",
    missing: 0,
    duplicates: 0,
    outOfOrder: 0,
    modelLoaded: false,
    workerLatencyMs: 0,
    newsFreshAt: 0,
    asset: "GBPUSD",
    payout: 0.87,
    payoutAt: 0,
    source: "simulated",
  },
  integrity: { duplicates: 0, outOfOrder: 0, gaps: 0, abnormalOhlc: 0, missing: 0, quality: 1, reasons: [] },
  risk: emptyRisk(DEFAULT_SETTINGS.bankroll),
  news: seedNews(),
  outcomes: [],
  bookRows: [],
  open: null,
  manage: null,
  outlook: null,
  scanner: null,
  sizeNote: "",
  memoryTrades: 0,
  memoryBytes: 0,
  netOnline: true,
  wire: [],
  scanMood: "unknown",
  scanAdv: null,
  scanDec: null,
  model: emptyModel(),
  lastComputeMs: 0,
  backtestReport: null,
  backtestBusy: false,
  now: Date.now(),
  toast: null,
  martingaleAck: false,
  resetOpen: false,
  feedSymbol: "",
  feedVenue: "",
  feedStale: false,
  quoteBid: null,
  quoteAsk: null,
  collectorLive: false,
  collectorDemo: false,
  collectorToken: "",
  collectorListening: false,
  extensionSeen: false,
  universe: [],
  universeAt: 0,

  boot: () => {
    try {
    if (timer != null && book && get().candles.length >= 60) return;
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
    engineOn = true;
    const { asset, timeframe, settings } = get();
    feedGen += 1;
    const gen = feedGen;
    book = null;
    feedMode = "simulated";
    feedSymbol = "";
    feedVenue = "";
    feedStale = false;
    quoteBid = null;
    quoteAsk = null;
    lastAsset = asset;
    lastTf = timeframe;
    lastSignalKey = "";
    lastPaperBar = "";
    const applyLive = (snap: SpotSnapshot) => {
      if (!book) return;
      const { closed, forming, report } = normalizeBook(
        book.forming ? [...book.candles, book.forming] : book.candles,
        get().timeframe,
        get().asset,
      );
      const px = book.price;
      set({
        candles: closed,
        forming,
        price: px,
        payout: book.payout,
        integrity: report,
        news: get().news.length ? get().news : seedNews(),
        feedSymbol,
        feedVenue,
        feedStale,
        quoteBid,
        quoteAsk,
        toast: snap.stale
          ? `Last session ${snap.venue} ${px}`
          : `Live ${snap.venue} ${px}`,
        health: {
          connected: true,
          lastCandleAt: Date.now(),
          interval: get().timeframe,
          missing: report.missing,
          duplicates: report.duplicates,
          outOfOrder: report.outOfOrder,
          modelLoaded: true,
          workerLatencyMs: 0,
          newsFreshAt: Date.now(),
          asset: get().asset,
          payout: book.payout,
          payoutAt: Date.now(),
          source: feedMode,
        },
      });
    };
    set({
      forming: null,
      signal: get().signal,
      open: get().open,
      manage: get().manage,
      lifecycle: get().open ? "SETTLING" : "COLLECTING",
      toast: get().open ? get().toast : "Loading live quote…",
      feedSymbol: "",
      feedVenue: "",
      feedStale: false,
      quoteBid: null,
      quoteAsk: null,
      health: {
        ...get().health,
        connected: false,
        source: get().health.source === "simulated" ? "simulated" : get().health.source,
        interval: timeframe,
        asset,
      },
    });
    if (!get().open) pushSim(set, get, "Loading live quote…");
    void loadSpotFeed(get, gen)
      .then((snap) => {
        if (!snap || gen !== feedGen) return;
        applyLive(snap);
      })
      .catch((err: unknown) => {
        if (gen !== feedGen) return;
        const msg = err instanceof Error ? err.message : "spot feed failed";
        pushSim(set, get, `${msg} — simulated tape`);
      });
    if (timer != null) window.clearInterval(timer);
    ensureClock(get);
    if (!get().open) void refreshUniverse(set, get);
    try {
      const saved = window.localStorage.getItem("exn-collector-token");
      if (saved && saved.startsWith("exn_")) {
        collectorToken = saved;
        set({ collectorToken: saved });
      }
    } catch {
      /* ignore */
    }
    try {
      const acc = window.localStorage.getItem("exn-account");
      if (acc) {
        const parsed = JSON.parse(acc) as { bankroll?: number; leverageCap?: number; riskPercent?: number };
        const cur = get().settings;
        const bankroll = parsed.bankroll && parsed.bankroll >= 10 ? parsed.bankroll : cur.bankroll;
        const leverageCap = parsed.leverageCap && parsed.leverageCap >= 1 ? parsed.leverageCap : cur.leverageCap;
        const riskPercent = parsed.riskPercent && parsed.riskPercent > 0 ? parsed.riskPercent : cur.riskPercent;
        set({
          settings: { ...cur, bankroll, leverageCap, riskPercent },
          risk: get().open ? get().risk : emptyRisk(bankroll),
        });
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = sessionStorage.getItem("exn-open");
      if (raw) {
        const snap = JSON.parse(raw) as { open?: OpenTrade; asset?: AssetId; timeframe?: Timeframe; risk?: RiskState; at?: number };
        if (snap.open && snap.at && Date.now() - snap.at < 2 * 60 * 60_000) {
          set({
            open: snap.open,
            asset: snap.asset ?? get().asset,
            timeframe: snap.timeframe ?? get().timeframe,
            risk: snap.risk ?? get().risk,
            lifecycle: "SETTLING",
            signal: snap.open.signal,
          });
        }
      }
    } catch {
      /* ignore */
    }
    if (!get().open) {
      void fetch("/api/desk?open=1")
        .then((res) => res.json())
        .then((json: { open?: { at?: number; ticket?: { open?: OpenTrade; asset?: AssetId; timeframe?: Timeframe; risk?: RiskState } } }) => {
          const snap = json.open?.ticket;
          if (!snap?.open || !json.open?.at || Date.now() - json.open.at > 2 * 60 * 60_000 || get().open) return;
          set({
            open: snap.open,
            asset: snap.asset ?? get().asset,
            timeframe: snap.timeframe ?? get().timeframe,
            risk: snap.risk ?? get().risk,
            lifecycle: "SETTLING",
            signal: snap.open.signal,
            toast: "Recovered the open paper after a restart",
          });
        })
        .catch(() => {});
    }
    if (collectorToken || (typeof window !== "undefined" && (location.hostname === "127.0.0.1" || location.hostname === "localhost"))) get().startCollectorListen();
    void pullWire(set, get);
    if (!pageHooked) {
      pageHooked = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") ensureClock(get);
      });
      window.addEventListener("online", () => {
        lastPoll = 0;
        lastWire = 0;
        set({ netOnline: true, toast: "Internet back — refreshing quotes" });
        void pullWire(set, get);
      });
      window.addEventListener("offline", () => {
        set({ netOnline: false, toast: "No internet — last saved candles stay on this PC" });
      });
      window.addEventListener("message", (ev) => {
        const d = ev.data as { source?: string; snapshot?: unknown } | null;
        if (!d || (d.source !== "exn-collector" && d.source !== "exn-signal-lab-collector")) return;
        if (d.snapshot) adoptCollector(set, get, d.snapshot);
      });
    }
    void hydrateMemory(set, get);
    void audit("boot", { version: MODEL_VERSION });
    void fetch("/api/desk?file=journal.json")
      .then((res) => res.json())
      .then((json: { value?: Outcome[] }) => {
        if (!Array.isArray(json.value) || json.value.length === 0) return;
        set({ outcomes: json.value, memoryTrades: json.value.length });
      })
      .catch(() => {});
    void fetch("/api/desk?file=settings.json")
      .then((res) => res.json())
      .then((json: { value?: Partial<LabSettings> | null }) => {
        if (!json.value || typeof json.value !== "object") return;
        set({ settings: { ...get().settings, ...json.value } });
      })
      .catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "boot failed";
      set({ toast: msg });
    }
  },

  tick: () => {
    try {
    const s = get();
    const now = Date.now();
    if (!book) {
      if (now - lastPoll > 3000 && !pollBusy) {
        const gen = feedGen;
        void loadSpotFeed(get, gen)
          .then((snap) => {
            if (!snap || gen !== feedGen || !book) return;
            const { closed, forming, report } = normalizeBook(
              book.forming ? [...book.candles, book.forming] : book.candles,
              get().timeframe,
              get().asset,
            );
            set({
              candles: closed,
              forming,
              price: book.price,
              payout: book.payout,
              integrity: report,
              feedSymbol,
              feedVenue,
              feedStale,
              quoteBid,
              quoteAsk,
              toast: snap.stale ? `Last session ${snap.venue} ${book.price}` : `Live ${snap.venue} ${book.price}`,
              health: {
                ...get().health,
                connected: true,
                lastCandleAt: now,
                interval: get().timeframe,
                asset: get().asset,
                payout: book.payout,
                payoutAt: now,
                source: feedMode,
                missing: report.missing,
                duplicates: report.duplicates,
                outOfOrder: report.outOfOrder,
                modelLoaded: true,
              },
            });
          })
          .catch((err: unknown) => {
            if (gen !== feedGen) return;
            const msg = err instanceof Error ? err.message : "spot feed failed";
            pushSim(set, get, `${msg} — simulated tape`);
          });
      } else {
        set({ now });
      }
      return;
    }
    if (s.asset !== lastAsset || s.timeframe !== lastTf) {
      lastAsset = s.asset;
      lastTf = s.timeframe;
      if (!book || book.asset !== s.asset || book.timeframe !== s.timeframe) {
        set({ now });
        return;
      }
    }
    const pollEvery = s.open ? 4000 : 2000;
    if (!collectorLive && now - lastPoll > pollEvery && !pollBusy) {
      const gen = feedGen;
      void loadSpotFeed(get, gen).catch(() => {
        /* keep last live book; retry next tick window */
      });
    }
    if (feedMode === "simulated") {
      book = stepMarket(book, now, rand);
    }
    const barMs = s.timeframe === "15m" ? 15 * 60_000 : s.timeframe === "5m" ? 5 * 60_000 : 60_000;
    const barDue = !!book.forming && now - book.forming.t >= barMs;
    if (
      s.signal &&
      !s.open &&
      feedMode !== "simulated" &&
      book.price === s.price &&
      !barDue &&
      now - lastScanAt < 2500 &&
      now - lastWire < 40_000
    ) {
      return;
    }
    const { closed, forming, report } = normalizeBook(
      book.forming ? [...book.candles, book.forming] : book.candles,
      s.timeframe,
      s.asset,
    );
    const similarHist = s.open
      ? []
      : s.outcomes
          .filter((o) => o.kind !== "TIE")
          .map((o) => ({ p: o.calibratedProbability, win: o.kind === "WIN" }));
    const lastAtr =
      atr(
        closed.map((c) => c.high),
        closed.map((c) => c.low),
        closed.map((c) => c.close),
        14,
      ) ?? 0;
    const spread =
      quoteBid != null && quoteAsk != null ? Math.max(0, quoteAsk - quoteBid) : spreadFor(s.asset, lastAtr);

    let next = s.signal;
    let lifecycle = s.lifecycle;
    let open = s.open;
    let outcomes = s.outcomes;
    let bookRows = s.bookRows;
    let risk = s.risk;
    let model = s.model;
    let computeMs = 0;
    let tape = s.signal;

    if (!open || now - lastScanAt > 2500) {
      const analyzed = analyze({
        closed,
        forming,
        settings: s.settings,
        model: s.model,
        news: s.news,
        quality: report.quality,
        sampleSize: similarHist.length,
        similar: similarWinRate(similarHist, 0.6),
        recentHit: similarHist.length
          ? similarHist.slice(-20).filter((x) => x.win).length / Math.min(20, similarHist.length)
          : 0.5,
        spread,
        now,
        wire: s.wire,
        mood: s.scanMood,
        bid: quoteBid,
        ask: quoteAsk,
      });
      lastScanAt = now;
      computeMs = analyzed.computeMs;
      if (!open) {
        next = analyzed.signal;
        tape = analyzed.signal;
        lifecycle = analyzed.signal.lifecycle;
      } else {
        tape = analyzed.signal;
      }
    } else if (open) {
      tape = s.scanner;
    }

    if (open) {
      const ticket = open;
      next = ticket.signal;
      lifecycle = "SETTLING";
      const hold = closed.filter((c) => c.t > ticket.entryBarT);
      const path = settlePath({
        direction: ticket.signal.direction,
        entry: ticket.signal.entryPrice,
        stop: ticket.signal.stopPrice,
        target: ticket.signal.targetPrice,
        bars: hold,
        timeout: hold.length >= MAX_HOLD_BARS,
      });
      const done = path.kind === "WIN" || path.kind === "LOSS" || (hold.length >= MAX_HOLD_BARS && hold.length > 0);
      if (done && hold.length > 0) {
        const out = settleSignal(ticket.signal, path, ticket.stake, {
          automatic: ticket.automatic,
          latencyMs: computeMs,
          source: "engine",
        });
        outcomes = [...outcomes, out].slice(-2000);
        risk = applyOutcome(risk, s.settings, out.kind === "WIN", out.kind === "TIE", out.grossProfit, now);
        void putOutcome(out);
        postDesk({
          action: "outcome",
          outcome: {
            strategy: out.strategy,
            kind: out.kind,
            outcomeR: out.outcomeR,
            calibratedProbability: out.calibratedProbability,
            settledAt: out.settledAt,
          },
        });
        postDesk({ action: "file", name: "journal.json", value: outcomes });
        postDesk({ action: "file", name: "candles.json", value: closed.slice(-240) });
        void putCandles(closed.slice(-240));
        const row = bookRows.find((r) => r.id === ticket.signal.signalKey);
        if (row) {
          const closedRow = closeBookRow(row, out.exitPrice, out.grossProfit);
          bookRows = [closedRow, ...bookRows.filter((r) => r.id !== closedRow.id)].slice(0, 80);
          void putOperation(closedRow);
        }
        const learned = maybeTrain({
          champion: s.model,
          rows: outcomes
            .filter((o) => o.kind !== "TIE")
            .slice(-400)
            .map((o) => ({ features: ticket.signal.features, y: o.kind === "WIN" ? 1 : 0 })),
        });
        model = learned.champion;
        void putModel(model);
        open = null;
        lifecycle = "SETTLED";
        next = { ...next, lifecycle: "SETTLED" };
        lastSignalKey = "";
      } else {
        const stopDist = Math.abs(ticket.signal.entryPrice - ticket.signal.stopPrice) || 1;
        const mark = exnessMark(ticket.signal.direction, book.price, quoteBid, quoteAsk);
        const liveR =
          (ticket.signal.direction === "BUY"
            ? mark - ticket.signal.entryPrice
            : ticket.signal.entryPrice - mark) / stopDist;
        open = {
          ...ticket,
          peakR: Math.max(ticket.peakR, liveR),
          troughR: Math.min(ticket.troughR, liveR),
        };
      }
    } else if (next && isTrade(next.direction)) {
      const ttlMs = (TIMEFRAME_SEC[s.timeframe] ?? 300) * 1000;
      if (s.signal && s.signal.signalKey === next.signalKey) {
        next = {
          ...next,
          predictionId: s.signal.predictionId,
          createdAt: s.signal.createdAt,
          signalKey: s.signal.signalKey,
          ageMs: now - s.signal.createdAt,
          validUntil: s.signal.createdAt + ttlMs,
        };
      } else {
        next = { ...next, validUntil: now + ttlMs };
      }
      lifecycle = "READY";
    }

    if (!next) {
      set({ now, candles: closed, forming, price: book.price, payout: book.payout, integrity: report });
      return;
    }

    const sized = open
      ? {
          stake: open.stake,
          lots: open.lots,
          leverage: next.suggestedLeverage,
          margin: next.marginUsd,
          notional: next.notionalUsd,
          blocked: null,
          note: "",
        }
      : sizeFor({ ...s, outcomes, risk, model }, next);
    if (!open) {
      next = {
        ...next,
        recommendedStake: sized.stake,
        recommendedLots: sized.lots,
        suggestedLeverage: sized.leverage,
        marginUsd: sized.margin,
        notionalUsd: sized.notional,
        expectedValue: expectedValue(next.calibratedProbability, 1.6, 1, 0.08),
        expectedValueR: next.expectedValueR,
        dailyRiskUsed: Math.max(0, -Math.min(0, risk.dailyPnl)),
        ageMs: now - next.createdAt,
      };
    }

    const barKey = next.signalKey || `${s.asset}|${s.timeframe}|${closed.at(-1)?.t ?? 0}|${next.direction}`;
    if (isTrade(next.direction) && barKey !== lastSignalKey && !open) {
      lastSignalKey = barKey;
      void putPrediction(next);
    }

    let manage = s.manage;
    let outlook: MarketOutlook | null = null;
    if (open) {
      manage = manageOpen({
        direction: open.signal.direction,
        entry: open.signal.entryPrice,
        stop: open.signal.stopPrice,
        target: open.signal.targetPrice,
        price: book.price,
        openedAt: open.openedAt,
        entryBarT: open.entryBarT,
        peakR: open.peakR,
        troughR: open.troughR,
        now,
        timeframe: s.timeframe,
        closed,
        forming,
        regime: tape?.regime ?? open.signal.regime,
        structure: tape?.structure ?? open.signal.structure,
        atr: lastAtr,
      });
      if (open.signal.direction === "BUY" || open.signal.direction === "SELL") {
        if (!cachedOutlook || now - cachedOutlookAt > 2000) {
          outlook = projectOutlook({
            direction: open.signal.direction,
            entry: open.signal.entryPrice,
            stop: open.signal.stopPrice,
            target: open.signal.targetPrice,
            price: book.price,
            atr: lastAtr,
            timeframe: s.timeframe,
            closed,
          });
          cachedOutlook = outlook;
          cachedOutlookAt = now;
        } else {
          outlook = cachedOutlook;
        }
      }
    } else {
      manage = null;
      cachedOutlook = null;
    }

    const prevLast = s.candles[s.candles.length - 1];
    const nextLast = closed[closed.length - 1];
    const sameCandles =
      s.candles.length === closed.length &&
      !!prevLast &&
      !!nextLast &&
      prevLast.t === nextLast.t &&
      prevLast.high === nextLast.high &&
      prevLast.low === nextLast.low &&
      prevLast.close === nextLast.close;
    const sameForm =
      s.forming?.t === forming?.t &&
      s.forming?.close === forming?.close &&
      s.forming?.high === forming?.high &&
      s.forming?.low === forming?.low;

    set({
      now,
      candles: sameCandles ? s.candles : closed,
      forming: sameForm ? s.forming : forming,
      price: book.price,
      payout: book.payout,
      signal: next,
      lifecycle,
      integrity: report,
      health: {
        connected: true,
        lastCandleAt: forming?.receivedAt ?? closed.at(-1)?.receivedAt ?? now,
        interval: s.timeframe,
        missing: report.missing,
        duplicates: report.duplicates,
        outOfOrder: report.outOfOrder,
        modelLoaded: true,
        workerLatencyMs: computeMs,
        newsFreshAt: s.news[0]?.t ?? now,
        asset: s.asset,
        payout: book.payout,
        payoutAt: now,
        source: feedMode,
      },
      feedSymbol,
      feedVenue,
      feedStale,
      quoteBid,
      quoteAsk,
      collectorLive,
      collectorDemo,
      manage,
      outlook,
      scanner: open ? tape : next,
      sizeNote: open ? s.sizeNote : sized.blocked || sized.note || "",
      toast:
        s.toast && (s.toast.startsWith("Connecting") || s.toast.startsWith("Loading")) && feedVenue && !open
          ? `${feedStale ? "Last session" : "Live"} ${feedVenue} ${book.price}`
          : s.toast,
      lastComputeMs: computeMs,
      risk,
      outcomes,
      bookRows,
      open,
      model,
      memoryTrades: outcomes.length,
    });
    persistTicket(open, s.asset, s.timeframe, risk);
    if (now - lastWire > 45_000) void pullWire(set, get);
    if (now - lastBreadth > 60_000) {
      lastBreadth = now;
      void pullBreadth(set);
    }
    if (!open && closed.length && closed.length % 80 === 0) void putCandles(closed.slice(-80));
    if (!open && now - lastUniverse > 40_000) void refreshUniverse(set, get);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "engine tick failed";
      set({ toast: msg });
    }
  },

  setAsset: (a) => {
    if (collectorLive) {
      set({ toast: "Collector is driving the pair — detach to pick a public feed" });
      return;
    }
    lastSignalKey = "";
    lastPaperBar = "";
    lastPoll = 0;
    lastWire = 0;
    feedGen += 1;
    const gen = feedGen;
    set({
      asset: a,
      toast: "Switching pair — last candles stay until the new quote arrives",
      health: { ...get().health, asset: a },
    });
    pushSim(set, get, "Loading live quote…");
    void loadSpotFeed(get, gen)
      .then((snap) => {
        if (!snap || gen !== feedGen || !book) return;
        applyIncoming(set, get, snap, snap.stale ? `Last session ${snap.venue} ${book.price}` : `Live ${snap.venue} ${book.price}`);
      })
      .catch((err: unknown) => {
        if (gen !== feedGen) return;
        lastPoll = 0;
        const msg = err instanceof Error ? err.message : "spot feed failed";
        pushSim(set, get, `${msg} — simulated tape`);
      });
  },
  setTimeframe: (tf) => {
    if (collectorLive) {
      set({ toast: "Collector is driving the timeframe — detach to pick a public feed" });
      return;
    }
    lastSignalKey = "";
    lastPaperBar = "";
    lastPoll = 0;
    feedGen += 1;
    const gen = feedGen;
    set({
      timeframe: tf,
      toast: "Loading live quote…",
      health: { ...get().health, connected: false, interval: tf },
    });
    pushSim(set, get, "Loading live quote…");
    void loadSpotFeed(get, gen)
      .then((snap) => {
        if (!snap || gen !== feedGen || !book) return;
        applyIncoming(set, get, snap, snap.stale ? `Last session ${snap.venue} ${book.price}` : `Live ${snap.venue} ${book.price}`);
      })
      .catch((err: unknown) => {
        if (gen !== feedGen) return;
        lastPoll = 0;
        const msg = err instanceof Error ? err.message : "spot feed failed";
        pushSim(set, get, `${msg} — simulated tape`);
      });
  },
  setView: (v) => set({ view: v }),
  patchSettings: (p) => {
    const settings = { ...get().settings, ...p };
    if (p.bankroll != null && Number.isFinite(p.bankroll)) {
      const b = Math.max(10, Math.round(p.bankroll * 100) / 100);
      settings.bankroll = b;
      const risk = get().risk;
      set({
        settings,
        risk: { ...risk, bankroll: b, equity: b, peakEquity: Math.max(risk.peakEquity, b) },
        toast: `Balance set to $${b.toLocaleString()}`,
      });
    } else {
      set({ settings });
    }
    try {
      window.localStorage.setItem(
        "exn-account",
        JSON.stringify({ bankroll: settings.bankroll, leverageCap: settings.leverageCap, riskPercent: settings.riskPercent }),
      );
    } catch {
      /* ignore quota */
    }
    postDesk({ action: "file", name: "settings.json", value: settings });
  },
  paper: () => {
    set({ toast: "Read only. This desk does not place an order." });
  },
  flatten: () => {
    set({ toast: "Read only. Nothing to close.", open: null, manage: null });
  },
  skip: () =>
    set({
      signal: get().signal
        ? { ...get().signal!, direction: "WAIT", lifecycle: "EXPIRED", cancelledReason: "Skipped" }
        : null,
      lifecycle: "IDLE",
    }),
  toggleKill: () => {
    const killed = !get().risk.killed;
    set({ risk: { ...get().risk, killed }, toast: killed ? "Kill-switch ON" : "Kill-switch OFF" });
  },
  requestResetRisk: () => set({ resetOpen: true }),
  confirmResetRisk: () => set({ risk: emptyRisk(get().settings.bankroll), resetOpen: false, toast: "Risk state reset" }),
  cancelResetRisk: () => set({ resetOpen: false }),
  runBacktest: () => {
    const s = get();
    set({ backtestBusy: true, view: "backtest" });
    window.setTimeout(() => {
      const live = s.candles;
      const useLive = feedMode !== "simulated" && live.length >= 80;
      const hist = useLive
        ? live
        : generateHistory({ asset: s.asset, timeframe: s.timeframe, bars: 720, seed: 77 }).candles;
      const source = useLive ? feedClaim(s.health.source, s.collectorDemo).text : "Simulated";
      const closed = hist.filter((c) => c.closed);
      const scored = scoreForecast(
        closed.map((c) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close })),
        { symbol: s.asset, timeframe: s.timeframe, source, horizonBars: DEFAULT_HORIZON_BARS },
      );
      const report = backtest({ candles: hist, settings: s.settings, model: s.model, folds: 4 });
      report.forecastValidation = {
        ...scored,
        source,
        symbol: s.asset,
        timeframe: s.timeframe,
        lastClosedTs: closed.at(-1)?.t ?? null,
      };
      set({ backtestReport: report, backtestBusy: false });
    }, 40);
  },
  exportJournal: () => {
    const s = get();
    return JSON.stringify(
      {
        version: MODEL_VERSION,
        exportedAt: new Date().toISOString(),
        outcomes: s.outcomes,
        metrics: {
          buckets: bucketStats(s.outcomes),
          byAsset: groupPerf(s.outcomes, (o) => o.asset),
          byRegime: groupPerf(s.outcomes, (o) => o.regime),
          pf: profitFactor(s.outcomes),
          dd: maxDrawdown(s.outcomes.map((o) => o.grossProfit)),
          lose: longestLose(s.outcomes),
          scores: scoreOutcomes(s.outcomes),
        },
      },
      null,
      2,
    );
  },
  wipe: async () => {
    await wipePersonal();
    set({ outcomes: [], bookRows: [], risk: emptyRisk(get().settings.bankroll), toast: "Personal data deleted" });
  },
  ackMartingale: (on) => set({ martingaleAck: on, settings: { ...get().settings, martingaleEnabled: on } }),
  ingestCollectorJson: (raw) => adoptCollector(set, get, raw),
  attachDemoCollector: () => {
    const s = get();
    const bars = (s.forming ? [...s.candles, s.forming] : s.candles).map((c) => ({
      t: c.t,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    if (bars.length < 8) {
      set({ toast: "Need a live public book first — wait for the desk, then attach demo" });
      return;
    }
    const demo = demoCollectorFromBars({
      asset: s.asset,
      timeframe: s.timeframe,
      price: s.price,
      bid: s.quoteBid,
      ask: s.quoteAsk,
      bars,
      payout: s.payout,
    });
    adoptCollector(set, get, demo);
  },
  detachCollector: () => {
    collectorLive = false;
    collectorDemo = false;
    feedGen += 1;
    const gen = feedGen;
    book = null;
    set({
      collectorLive: false,
      collectorDemo: false,
      candles: [],
      forming: null,
      signal: null,
      open: null,
      manage: null,
      outlook: null,
      lifecycle: "COLLECTING",
      toast: "Collector detached — loading public spot…",
    });
    void loadSpotFeed(get, gen)
      .then((snap) => {
        if (!snap || gen !== feedGen || !book) return;
        applyIncoming(set, get, snap, snap.stale ? `Last session ${snap.venue} ${book.price}` : `Live ${snap.venue} ${book.price}`);
      })
      .catch((err: unknown) => {
        if (gen !== feedGen) return;
        const msg = err instanceof Error ? err.message : "spot feed failed";
        pushSim(set, get, `${msg} — simulated tape`);
      });
  },
  startCollectorListen: () => {
    const poll = async () => {
      if (!collectorToken) return;
      try {
        const res = await fetch("/api/collector", { headers: { "x-desk-token": collectorToken } });
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; snapshot?: { hello?: boolean; price?: number } };
        if (!json.ok || !json.snapshot) return;
        if (json.snapshot.hello === true && !(Number(json.snapshot.price) > 0)) {
          set({ extensionSeen: true, toast: "Extension linked. Open the Exness terminal for quotes." });
          return;
        }
        adoptCollector(set, get, json.snapshot);
      } catch {
        /* empty until the extension posts */
      }
    };
    void (async () => {
      const bridge = (window as Window & { exnDesktop?: { getToken: () => Promise<string> } }).exnDesktop;
      if (!bridge) {
        set({ toast: "The pairing token is shown only inside the Windows desktop app." });
        return;
      }
      try {
        const token = (await bridge.getToken()).trim();
        if (!token) {
          set({ toast: "Desktop app has no pairing token." });
          return;
        }
        collectorToken = token;
        set({ collectorToken, collectorListening: true, toast: "Token loaded from this PC. Paste it into the extension. No order is sent." });
        void poll();
        if (collectorListenTimer != null) window.clearInterval(collectorListenTimer);
        collectorListenTimer = window.setInterval(() => void poll(), 2000);
      } catch {
        set({ toast: "Desktop app did not provide a token." });
      }
    })();
  },
  stopCollectorListen: () => {
    if (collectorListenTimer != null) {
      window.clearInterval(collectorListenTimer);
      collectorListenTimer = null;
    }
    set({ collectorListening: false });
  },
}));

export function stopLab() {
  engineOn = false;
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (collectorListenTimer != null) {
    window.clearInterval(collectorListenTimer);
    collectorListenTimer = null;
  }
}

function ensureClock(get: () => { tick: () => void }) {
  if (timer != null) return;
  engineOn = true;
  timer = window.setInterval(() => get().tick(), 1000);
}
