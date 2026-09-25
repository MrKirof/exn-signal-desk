import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Gauge,
  LineChart,
  Settings as SettingsIcon,
  Shield,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { APP_NAME, APP_VERSION, ASSETS } from "@/lib/lab/constants";
import { t } from "@/lib/lab/i18n";
import { feedClaim } from "@/lib/lab/source-label";
import type { AssetId, Timeframe, ViewId } from "@/lib/lab/types";
import { useLab } from "@/store/lab-store";
import { CandleChart } from "./candle-chart";
import { readWire } from "@/lib/lab/news";
import { readEdge } from "@/lib/lab/edge";
import { SignalPanel } from "./signal-panel";
import { AccountBox } from "./account-box";
import { BacktestPanel, HealthPanel, JournalPanel, PerformancePanel, RiskPanel, SettingsPanel } from "./panels";
import { AgentsPanel } from "./agents-panel";
import { Layer } from "./layer";
import { fmtPx, fmtUsd, regimeLabel } from "./format";
import { cn } from "@/lib/utils";
import { adx, atr, ema, efficiencyRatio, rsi } from "@/lib/lab/indicators";

const VIEWS: { id: ViewId; icon: typeof Activity; key: "desk" | "health" | "risk" | "performance" | "backtest" | "journal" | "settings" | "agents" }[] = [
  { id: "desk", icon: Activity, key: "desk" },
  { id: "health", icon: Gauge, key: "health" },
  { id: "risk", icon: Shield, key: "risk" },
  { id: "performance", icon: BarChart3, key: "performance" },
  { id: "backtest", icon: LineChart, key: "backtest" },
  { id: "journal", icon: BookOpen, key: "journal" },
  { id: "agents", icon: Bot, key: "agents" },
  { id: "settings", icon: SettingsIcon, key: "settings" },
];

const TFS: Timeframe[] = ["1m", "5m", "15m"];

export function LabShell() {
  const boot = useLab((s) => s.boot);
  const theme = useLab((s) => s.settings.theme);
  const lang = useLab((s) => s.settings.lang);
  const view = useLab((s) => s.view);
  const setView = useLab((s) => s.setView);
  const asset = useLab((s) => s.asset);
  const setAsset = useLab((s) => s.setAsset);
  const timeframe = useLab((s) => s.timeframe);
  const setTimeframe = useLab((s) => s.setTimeframe);
  const health = useLab((s) => s.health);
  const feedSymbol = useLab((s) => s.feedSymbol);
  const feedVenue = useLab((s) => s.feedVenue);
  const feedStale = useLab((s) => s.feedStale);
  const price = useLab((s) => s.price);
  const quoteBid = useLab((s) => s.quoteBid);
  const quoteAsk = useLab((s) => s.quoteAsk);
  const collectorDemo = useLab((s) => s.collectorDemo);
  const risk = useLab((s) => s.risk);
  const toast = useLab((s) => s.toast);
  const patch = useLab((s) => s.patchSettings);
  const paper = useLab((s) => s.paper);
  const skip = useLab((s) => s.skip);
  const toggleKill = useLab((s) => s.toggleKill);
  const resetOpen = useLab((s) => s.resetOpen);
  const confirmResetRisk = useLab((s) => s.confirmResetRisk);
  const cancelResetRisk = useLab((s) => s.cancelResetRisk);
  const density = useLab((s) => s.settings.density);
  const locked = risk.killed || risk.dailyStopHit;
  const signal = useLab((s) => s.signal);
  const openTrade = useLab((s) => s.open);
  const scanner = useLab((s) => s.scanner);
  const tape = openTrade ? scanner ?? signal : signal;

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-view-id],[data-asset-id]") as HTMLElement | null;
      if (!el) return;
      const viewId = el.getAttribute("data-view-id");
      const assetId = el.getAttribute("data-asset-id");
      if (viewId) setView(viewId as ViewId);
      if (assetId) setAsset(assetId as AssetId);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [setAsset, setView]);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.lang = lang === "bn" ? "bn" : "en";
  }, [theme, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === "1") paper(true);
      if (e.key === "2") skip();
      if (e.key === "k" || e.key === "K") toggleKill();
      if (e.key === "d") setView("desk");
      if (e.key === "h") setView("health");
      if (e.key === "r") setView("risk");
      if (e.key === "j") setView("journal");
      if (e.key === "a") setView("agents");
      if (e.key === "b") setView("backtest");
      if (e.key === "t") patch({ theme: theme === "dark" ? "light" : "dark" });
      if (e.key === "e") window.open("/api/desk?report=1", "_blank");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paper, skip, toggleKill, setView, patch, theme]);

  useEffect(() => {
    const pane = new URLSearchParams(window.location.search).get("pane");
    if (pane === "journal") setView("journal");
    if (pane === "signal" || pane === "chart") setView("desk");
  }, [setView]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetch("/api/desk")
        .then((res) => res.json())
        .then((json: { status?: { risk?: { masterOff?: boolean } } }) => {
          if (json.status?.risk?.masterOff && !locked) toggleKill();
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(id);
  }, [toggleKill, locked]);

  const claim = feedClaim(health.source, collectorDemo);
  const feedLabel = claim.liveExness
    ? `${feedStale ? "Stale" : "Live"} ${feedVenue || "Exness"}`
    : health.source === "fixture" || collectorDemo
      ? claim.text
      : health.source === "unverified" || health.source === "exness"
        ? claim.text
        : health.connected && health.source !== "simulated" && (feedVenue || feedSymbol)
          ? `${feedStale ? "Last session" : "Live"} ${feedVenue || feedSymbol}`
          : price > 0 && (feedVenue || health.source === "simulated")
            ? feedVenue || t(lang, "simulatedTape")
            : t(lang, "connecting");
  const ledClass = !health.connected
    ? "led-warn"
    : health.source === "simulated" || feedStale
      ? "led-warn"
      : "led-live";

  return (
    <div className="flex min-h-dvh overflow-x-hidden bg-bg text-fg">
      <aside className="hidden w-20 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 items-center justify-center border-b border-border">
          <span className="font-mono text-xs font-medium text-accent">EXN</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-1.5" aria-label="Primary">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                data-view-id={v.id}
                onClick={() => setView(v.id)}
                title={t(lang, v.key)}
                className={cn(
                  "flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-md text-muted",
                  view === v.id ? "bg-elevated text-fg" : "hover:bg-elevated hover:text-fg",
                )}
              >
                <Icon className="size-4" strokeWidth={1.7} />
                <span className="max-w-full truncate text-xs leading-none">{t(lang, v.key)}</span>
              </button>
            );
          })}
        </nav>
        <p className="pb-3 text-center font-mono text-xs text-subtle">{APP_VERSION}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-surface">
          <div className="flex h-14 items-center gap-3 px-3 lg:px-4">
            <div className="min-w-0 shrink-0">
              <p className="truncate text-sm font-medium">{APP_NAME}</p>
              <p className="hidden truncate text-xs text-muted sm:block">{feedLabel}</p>
            </div>
            <div className="flex items-baseline gap-3">
              <span className={cn("led", ledClass)} aria-hidden />
              <p className="quote text-2xl leading-none">{fmtPx(asset, price)}</p>
            </div>
            {quoteBid != null && quoteAsk != null && (
              <div className="hidden font-mono text-xs tabular-nums sm:block">
                <p className="text-call">Ask {fmtPx(asset, quoteAsk)}</p>
                <p className="text-put">Bid {fmtPx(asset, quoteBid)}</p>
              </div>
            )}
            <p className={cn("hidden font-mono text-sm sm:block", risk.dailyPnl >= 0 ? "text-call" : "text-put")}>{fmtUsd(risk.dailyPnl)}</p>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {locked && <Badge variant="put">Locked</Badge>}
              <AccountBox compact />
              <UtcClock />
              <Button size="sm" variant="ghost" onClick={() => patch({ lang: lang === "en" ? "bn" : "en" })}>
                {lang === "en" ? "BN" : "EN"}
              </Button>
              <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => patch({ theme: theme === "dark" ? "light" : "dark" })}>
                {theme === "dark" ? "Light" : "Dark"}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto border-t border-border px-3 py-2 lg:px-4">
            <div className="seg shrink-0">
              {ASSETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="seg-btn whitespace-nowrap"
                  data-asset-id={a.id}
                  data-on={asset === a.id ? "true" : "false"}
                  onClick={() => setAsset(a.id)}
                  title={a.label}
                >
                  {a.id.replace("USD", "") === a.id ? "JPY" : a.id.replace("USD", "")}
                </button>
              ))}
            </div>
            <div className="seg shrink-0">
              {TFS.map((tf) => (
                <button key={tf} type="button" className="seg-btn" data-on={timeframe === tf ? "true" : "false"} onClick={() => setTimeframe(tf)}>
                  {tf}
                </button>
              ))}
            </div>
            {tape && (
              <p className="hidden min-w-0 truncate font-mono text-xs text-muted md:block">
                {regimeLabel(tape.regime)} · {tape.session?.label ?? "—"} · {tape.structure?.zone ?? "—"} · CF {tape.confluence?.score ?? 0}/{tape.confluence?.max ?? 0}
              </p>
            )}
            <nav className="ml-auto hidden gap-1 sm:flex lg:hidden" aria-label="Screens">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  data-view-id={v.id}
                  onClick={() => setView(v.id)}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1.5 text-sm",
                    view === v.id ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {t(lang, v.key)}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {view === "desk" && <MarketScan />}

        {toast && (
          <div className="border-b border-border bg-elevated px-4 py-2 text-center text-xs text-fg" role="status">
            {toast}
          </div>
        )}

        <main id="main" data-current-view={view} className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-3 pb-20 lg:p-4 lg:pb-4">
          {view === "desk" && (
            <Layer name="Desk">
              <Desk density={density} />
            </Layer>
          )}
          {view === "health" && (
            <Layer name="Health">
              <HealthPanel />
            </Layer>
          )}
          {view === "risk" && (
            <Layer name="Risk">
              <RiskPanel />
            </Layer>
          )}
          {view === "performance" && (
            <Layer name="Performance">
              <PerformancePanel />
            </Layer>
          )}
          {view === "backtest" && (
            <Layer name="Backtest">
              <BacktestPanel />
            </Layer>
          )}
          {view === "journal" && (
            <Layer name="Journal">
              <JournalPanel />
            </Layer>
          )}
          {view === "agents" && (
            <Layer name="Agents">
              <AgentsPanel />
            </Layer>
          )}
          {view === "settings" && (
            <Layer name="Settings">
              <SettingsPanel />
            </Layer>
          )}
        </main>

        <footer className="hidden border-t border-border px-4 py-2 text-center text-xs text-subtle lg:block">
          {t(lang, "disclaimer")} · 1 paper · 2 skip · K kill · A agents · E report
        </footer>

        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur-sm lg:hidden" aria-label="Primary">
          <div className="grid grid-cols-8">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  type="button"
                  data-view-id={v.id}
                  onClick={() => setView(v.id)}
                  aria-label={t(lang, v.key)}
                  className={cn(
                    "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-xs",
                    view === v.id ? "text-accent" : "text-muted",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.6} />
                  <span className="max-w-full truncate px-0.5">{t(lang, v.key)}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={(o) => (!o ? cancelResetRisk() : null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t(lang, "resetRisk")}</AlertDialogTitle>
          <AlertDialogDescription>
            This clears daily P/L, streaks, pauses and kill-switch. Bankroll setting is kept. Confirm to continue.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary" onClick={cancelResetRisk}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={confirmResetRisk}>Reset</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UtcClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const d = now == null ? null : new Date(now);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    <time className="hidden font-mono text-xs tabular-nums text-muted md:inline" dateTime={d?.toISOString()}>
      {d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC` : "— UTC"}
    </time>
  );
}

function Desk({ density }: { density: "compact" | "advanced" }) {
  const candles = useLab((s) => s.candles);
  const forming = useLab((s) => s.forming);
  const signal = useLab((s) => s.signal);
  const outcomes = useLab((s) => s.outcomes);
  const news = useLab((s) => s.news);
  const health = useLab((s) => s.health);
  const risk = useLab((s) => s.risk);
  const integrity = useLab((s) => s.integrity);
  const collectorDemo = useLab((s) => s.collectorDemo);
  const asset = useLab((s) => s.asset);
  const manage = useLab((s) => s.manage);
  const outlook = useLab((s) => s.outlook);
  const pane = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pane");
  return (
      <div className="flex flex-col gap-3">
        {pane !== "signal" && (
          <Layer name="Chart">
            <div className="panel relative h-[min(52vh,560px)] min-h-[280px] overflow-hidden">
              <CandleChart
                candles={candles}
                forming={forming}
                signal={signal}
                outcomes={outcomes}
                news={news}
                trailStop={manage?.trailStop ?? 0}
                levels={outlook?.levels ?? []}
              />
            </div>
          </Layer>
        )}
        {pane !== "chart" && (
          <Layer name="Signal">
            <SignalPanel />
          </Layer>
        )}
        {pane !== "signal" && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <ScoreBoard />
              <UniverseBoard />
              <AccountBox />
              <div className="flex flex-col gap-3">
                <PathOutlook />
                <WireNotes />
                <TapeReadout asset={asset} />
              </div>
            </div>
            <TradeBook />
            {density === "advanced" && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini
                  k="Feed"
                  v={feedClaim(health.source, collectorDemo).liveExness ? "exness" : health.source === "fixture" || collectorDemo ? "fixture" : health.source === "unverified" || health.source === "exness" ? "unverified" : health.source === "simulated" ? (health.connected ? "sim" : "wait") : health.source}
                />
                <Mini k="Quality" v={`${Math.round(integrity.quality * 100)}%`} />
                <Mini k="Latency" v={`${health.workerLatencyMs.toFixed(0)}ms`} />
                <Mini k="Equity" v={fmtUsd(risk.equity)} />
              </div>
            )}
          </div>
        )}
        <PriceTape />
      </div>
  );
}

function UniverseBoard() {
  const rows = useLab((s) => s.universe);
  const asset = useLab((s) => s.asset);
  const timeframe = useLab((s) => s.timeframe);
  const setAsset = useLab((s) => s.setAsset);
  const setTimeframe = useLab((s) => s.setTimeframe);
  const tfs: Timeframe[] = ["1m", "5m", "15m"];
  const hits = rows.filter((r) => r.direction !== "WAIT");
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="kicker">Universe scan</p>
        <p className="font-mono text-xs text-muted">
          {rows.length === 0 ? "SCAN…" : hits.length ? `${hits.length} READY` : "FLAT"}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1 text-sm">
        <p className="kicker px-1 pb-1">Pair</p>
        {tfs.map((tf) => (
          <p key={tf} className="kicker px-1 pb-1">
            {tf}
          </p>
        ))}
        {ASSETS.map((spec) => (
          <div key={spec.id} className="contents">
            <button
              className={cn("h-10 px-1 text-left font-medium", spec.id === asset ? "text-fg" : "text-muted")}
              onClick={() => setAsset(spec.id)}
            >
              {spec.label}
            </button>
            {tfs.map((tf) => {
              const row = rows.find((r) => r.asset === spec.id && r.timeframe === tf);
              const dir = row?.direction ?? "WAIT";
              const shown = dir === "WAIT" && row?.pending && row.pending !== "WAIT" ? row.pending : dir;
              const active = spec.id === asset && tf === timeframe;
              return (
                <button
                  key={tf}
                  className={cn(
                    "h-10 rounded-sm px-1 font-mono",
                    active && "bg-elevated",
                    shown === "BUY" && "bg-call/10 text-call",
                    shown === "SELL" && "bg-put/10 text-put",
                    shown === "WAIT" && "text-muted",
                  )}
                  onClick={() => {
                    if (spec.id !== asset) setAsset(spec.id);
                    if (tf !== timeframe) setTimeframe(tf);
                  }}
                  title={row?.reason ?? ""}
                >
                  {row ? (dir === "WAIT" && row.pending !== "WAIT" ? `~${row.pending}` : dir) : "…"}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreBoard() {
  const rows = useLab((s) => s.outcomes);
  const decided = rows.filter((o) => o.kind === "WIN" || o.kind === "LOSS");
  const wins = decided.filter((o) => o.kind === "WIN").length;
  const wr = decided.length ? wins / decided.length : 0;
  const avgR = decided.length ? decided.reduce((a, o) => a + o.outcomeR, 0) / decided.length : 0;
  const edge = readEdge(decided.map((o) => o.outcomeR));
  const even = 0.42;
  const label = decided.length < 30 ? "too few to trust" : wr + 0.005 < even ? "below break-even" : "above break-even";
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="kicker">Paper score</p>
        <p className="font-mono text-xs text-muted">{label}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini k="Closed" v={String(decided.length)} />
        <Mini k="Win rate" v={decided.length ? `${(wr * 100).toFixed(0)}%` : "—"} />
        <Mini k="Need" v="42%" />
        <Mini k="Avg R" v={decided.length ? `${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}` : "—"} />
      </div>
      <p className="mt-2 text-xs text-fg">
        Shuffled path {edge.verdict}. Typical {edge.medianPathR >= 0 ? "+" : ""}
        {edge.medianPathR.toFixed(1)}R · bad run {edge.badPathR.toFixed(1)}R · lose paths {Math.round(edge.pLose * 100)}%.
      </p>
      <p className="mt-1 text-xs text-muted">{edge.why}</p>
      <p className="mt-2 text-xs text-muted">
        {decided.length < 30
          ? `Strict filter is on until ${30 - decided.length} more closed papers. Weak setups stay WAIT.`
          : "Win rate uses only your closed papers on this PC. It is not a promise."}
      </p>
    </div>
  );
}

function TradeBook() {
  const rows = useLab((s) => s.bookRows);
  if (!rows.length) return null;
  return (
    <div className="panel p-3">
      <p className="kicker">Trade book</p>
      <ul className="mt-2 space-y-1 text-xs">
        {rows.slice(0, 6).map((row) => (
          <li key={row.id} className="flex items-baseline justify-between gap-2 font-mono">
            <span>
              {row.action} {row.symbol} {row.quantity} @ {row.price}
            </span>
            <span className={row.pnl == null ? "text-muted" : row.pnl >= 0 ? "text-call" : "text-put"}>
              {row.pnl == null ? "open" : `${row.pnl >= 0 ? "+" : ""}${row.pnl.toFixed(2)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarketScan() {
  const mood = useLab((s) => s.scanMood);
  const adv = useLab((s) => s.scanAdv);
  const dec = useLab((s) => s.scanDec);
  const [scan, setScan] = useState<{
    ms?: number;
    mood?: string;
    tape?: string | null;
    source?: string;
    finviz?: { ticker: string; change: string }[];
    messari?: { symbol: string; rank: number }[];
    finvizError?: string | null;
    messariError?: string | null;
  } | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      void fetch("/api/scan")
        .then((r) => r.json())
        .then((body) => {
          if (!stop) setScan(body);
        })
        .catch(() => {
          if (!stop) setScan(null);
        });
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const moodLine = scan?.tape
    ? `${scan.tape}. Mood ${scan.mood ?? mood}. Used on bitcoin, gold, and dollar-yen only.`
    : mood === "unknown" || adv == null
      ? "Stock mood loading"
      : `US stocks ${adv.toFixed(0)}% up, ${dec == null ? "—" : dec.toFixed(0)}% down · ${mood}. Used on bitcoin, gold, and dollar-yen only.`;

  return (
    <div className="border-b border-border bg-bg px-3 py-2 lg:px-4">
      <p className="truncate text-sm text-muted">
        <span className="text-fg">Market</span>
        {" · "}
        {moodLine}
        {(scan?.finviz ?? []).length > 0 ? ` · ${scan!.finviz!.slice(0, 4).map((row) => `${row.ticker} ${row.change}`).join(" · ")}` : ""}
      </p>
    </div>
  );
}

function WireNotes() {
  const wire = useLab((s) => s.wire);
  const netOnline = useLab((s) => s.netOnline);
  if (!wire.length) return null;
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="kicker">Web headlines</p>
        <p className="font-mono text-xs text-muted">{netOnline ? "Google News" : "last saved"}</p>
      </div>
      <ul className="space-y-1 text-xs text-muted">
        {wire.map((h) => (
          <li key={h.title}>
            {h.url ? (
              <a className="hover:text-fg" href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
            ) : (
              h.title
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PathOutlook() {
  const outlook = useLab((s) => s.outlook);
  const manage = useLab((s) => s.manage);
  const open = useLab((s) => s.open);
  const flatten = useLab((s) => s.flatten);
  const asset = useLab((s) => s.asset);
  const wire = useLab((s) => s.wire);
  const web = readWire(wire, asset);
  if (!open) return null;
  const dir = open.signal.direction;
  const r = manage?.unrealizedR ?? 0;
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="kicker">Paper ticket · {dir}</p>
        <button type="button" className="font-mono text-xs text-muted" onClick={flatten}>
          Close ticket
        </button>
      </div>
      <p className={cn("quote text-2xl", r >= 0 ? "text-call" : "text-put")}>
        {r >= 0 ? "+" : ""}
        {r.toFixed(2)}R
      </p>
      <p className="mt-1 text-xs text-muted">
        Entry {fmtPx(asset, open.signal.entryPrice)} · stop {fmtPx(asset, open.signal.stopPrice)} · target {fmtPx(asset, open.signal.targetPrice)} · {open.lots} lot
      </p>
      <p className="mt-1 text-sm text-fg">{manage?.headline || "Ticket is live. R updates with the price."}</p>
      {outlook ? (
        <>
      <p className="mt-2 text-xs text-fg">
        Move {outlook.move}. Candle {outlook.candleName ?? "none"}
        {outlook.candleAgrees == null ? "" : outlook.candleAgrees ? " · agrees" : " · against the ticket"}.
        {manage ? ` · ${manage.headline}` : ""} {web.line}
      </p>
      <p className="mt-1 font-mono text-xs text-muted">
        {outlook.levels.map((lv) => `${lv.kind === "support" ? "S" : "R"} ${fmtPx(asset, lv.price)}`).join("  ·  ") || "no swing levels yet"}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {outlook.horizons.map((h) => (
          <div key={h.label} className="panel-inset px-3 py-2">
            <div className="flex items-baseline justify-between">
              <p className="kicker">{h.label}</p>
              <p className={cn("quote text-sm", h.expectedR >= 0 ? "text-call" : "text-put")}>
                {h.expectedR >= 0 ? "+" : ""}
                {h.expectedR.toFixed(2)}R
              </p>
            </div>
            <p className="mt-1 font-mono text-xs">
              {fmtPx(asset, h.low1)} · {fmtPx(asset, h.expectedPrice)} · {fmtPx(asset, h.high1)}
            </p>
            <p className="mt-1 text-xs text-muted">{h.read}</p>
            <p className="mt-1 text-xs text-subtle">{h.touch}</p>
            <p className="mt-1 text-xs text-subtle">Uncalibrated model band. Not a probability.</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{outlook.note}</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">Path model starts on the next price update.</p>
      )}
    </div>
  );
}

function PriceTape() {
  const price = useLab((s) => s.price);
  const asset = useLab((s) => s.asset);
  const [prints, setPrints] = useState<{ px: number; up: boolean; n: number }[]>([]);
  useEffect(() => {
    if (!(price > 0)) return;
    setPrints((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.px === price) return prev;
      return [...prev, { px: price, up: !last || price >= last.px, n: (last?.n ?? 0) + 1 }].slice(-28);
    });
  }, [price]);
  return (
    <div className="panel flex items-center gap-3 overflow-hidden px-3 py-2">
      <p className="kicker shrink-0">Tape</p>
      <div className="flex min-w-0 gap-3 overflow-hidden">
        {prints.length === 0 ? <span className="font-mono text-xs text-muted">Waiting for a price.</span> : null}
        {prints.map((print) => (
          <span key={print.n} className={cn("shrink-0 font-mono text-xs", print.up ? "text-call" : "text-put")}>
            {fmtPx(asset, print.px)}
          </span>
        ))}
      </div>
    </div>
  );
}

function TapeReadout({ asset }: { asset: AssetId }) {
  const candles = useLab((s) => s.candles);
  const signal = useLab((s) => s.signal);
  const tape = useMemo(() => {
    if (candles.length < 30) return null;
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    const last = candles[candles.length - 1]!;
    const stack = e9 != null && e21 != null && e50 != null ? (e9 > e21 && e21 > e50 ? "up" : e9 < e21 && e21 < e50 ? "down" : "mixed") : "—";
    return {
      last: last.close,
      e9,
      e21,
      e50,
      stack,
      r: rsi(closes, 14),
      d: adx(highs, lows, closes, 14),
      a: atr(highs, lows, closes, 14),
      er: efficiencyRatio(closes, 10),
    };
  }, [candles]);
  if (!tape) {
    return (
      <div className="panel px-3 py-3 text-sm text-muted">
        Collecting closed candles for the tape…
      </div>
    );
  }
  const watch =
    signal?.regime === "TREND_UP"
      ? `Watch pullback hold on EMA21 ${tape.e21 != null ? fmtPx(asset, tape.e21) : ""}`
      : signal?.regime === "TREND_DOWN"
        ? `Watch pullback reject EMA21 ${tape.e21 != null ? fmtPx(asset, tape.e21) : ""}`
        : signal?.regime === "RANGE"
          ? "Watch range-edge rejection"
          : signal?.regime === "EXPANSION"
            ? "Watch breakout retest, no chase"
            : "Watch regime confirm (2 matching bars)";
  return (
    <div className="panel p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        <Mini k="Last" v={fmtPx(asset, tape.last)} />
        <Mini k="EMA9" v={tape.e9 == null ? "—" : fmtPx(asset, tape.e9)} />
        <Mini k="EMA21" v={tape.e21 == null ? "—" : fmtPx(asset, tape.e21)} />
        <Mini k="EMA50" v={tape.e50 == null ? "—" : fmtPx(asset, tape.e50)} />
        <Mini k="Stack" v={tape.stack} />
        <Mini k="RSI" v={tape.r == null ? "—" : tape.r.toFixed(1)} />
        <Mini k="ADX" v={tape.d == null ? "—" : tape.d.toFixed(1)} />
        <Mini k="ATR" v={tape.a == null ? "—" : fmtPx(asset, tape.a)} />
        <Mini k="Zone" v={signal?.structure?.zone ?? "—"} />
        <Mini k="Session" v={signal?.session?.name ?? "—"} />
        <Mini k="Candle" v={signal?.candle?.best ? signal.candle.best.name.replace(" / ", " · ") : "—"} />
      </div>
      <p className="mt-2 font-mono text-xs text-muted">
        ER {tape.er == null ? "—" : tape.er.toFixed(2)} · {watch}
        {signal?.candle?.best ? ` · ${signal.candle.best.why}` : ""}
      </p>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="panel-inset px-3 py-2">
      <p className="kicker">{k}</p>
      <p className="quote text-sm">{v}</p>
    </div>
  );
}
