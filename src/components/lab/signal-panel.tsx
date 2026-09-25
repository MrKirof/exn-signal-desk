import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/lab/i18n";
import type { I18nKey } from "@/lib/lab/i18n";
import { useLab } from "@/store/lab-store";
import type { TradeManage } from "@/lib/lab/manage";
import { ageSec, fmtPx, fmtUsd, regimeLabel } from "./format";
import { cn } from "@/lib/utils";
import { assetMeta } from "@/lib/lab/constants";
import { bookRisk, skillScan } from "@/lib/lab/skill-desk";
import { readJev } from "@/lib/lab/jev";
import { dataOrigin, originLabel } from "@/lib/lab/source-label";
import { readSmc, riskWarning, timeframeMatrix } from "@/lib/lab/context-filters";
import { DEFAULT_HORIZON_BARS, HORIZON_CHOICES, forecastMove } from "@/lib/lab/forecast";

export function SignalPanel() {
  const lang = useLab((s) => s.settings.lang);
  const signal = useLab((s) => s.signal);
  const scanner = useLab((s) => s.scanner);
  const price = useLab((s) => s.price);
  const asset = useLab((s) => s.asset);
  const timeframe = useLab((s) => s.timeframe);
  const lifecycle = useLab((s) => s.lifecycle);
  const risk = useLab((s) => s.risk);
  const paper = useLab((s) => s.paper);
  const skip = useLab((s) => s.skip);
  const health = useLab((s) => s.health);
  const collectorDemo = useLab((s) => s.collectorDemo);
  const feedStale = useLab((s) => s.feedStale);
  const open = useLab((s) => s.open);
  const shown = open ? scanner ?? signal : signal;
  const manage = useLab((s) => s.manage);
  const flatten = useLab((s) => s.flatten);
  const density = useLab((s) => s.settings.density);
  const sizeNote = useLab((s) => s.sizeNote);
  const quoteBid = useLab((s) => s.quoteBid);
  const quoteAsk = useLab((s) => s.quoteAsk);
  const settings = useLab((s) => s.settings);
  const candles = useLab((s) => s.candles);
  const outcomes = useLab((s) => s.outcomes);
  const scan = skillScan(candles.filter((c) => c.closed));
  const jev = readJev(
    candles.filter((c) => c.closed),
    shown?.regime ?? "MIXED",
    {
      bid: quoteBid,
      ask: quoteAsk,
      spread: quoteBid != null && quoteAsk != null ? Math.max(0, quoteAsk - quoteBid) : 0,
    },
  );
  const riskBook = bookRisk(outcomes.map((o) => o.outcomeR));
  const tt = (k: I18nKey) => t(lang, k);
  const [horizonBars, setHorizonBars] = useState(DEFAULT_HORIZON_BARS);

  const readyBars = candles.filter((c) => c.closed).length;
  const loading = !open && readyBars < 40;
  const dir = shown?.direction ?? "WAIT";
  const p = shown?.calibratedProbability ?? 0.5;
  const spread = quoteBid != null && quoteAsk != null ? quoteAsk - quoteBid : assetMeta(asset).typicalSpread;
  const dirLabel = loading ? "…" : dir === "BUY" ? "LONG" : dir === "SELL" ? "SHORT" : "WAIT";
  const origin = originLabel(dataOrigin(health.source, collectorDemo), feedStale || !health.connected);
  const calibrated = shown?.calibrationStatus === "usable" || shown?.calibrationStatus === "ok";
  const lastClosed = candles.filter((c) => c.closed).at(-1);
  const closedBars = candles.filter((c) => c.closed);
  const smc = readSmc(closedBars);
  const matrix = timeframeMatrix(closedBars);
  const standAside = riskWarning(closedBars, shown?.cancelledReason?.includes("High-impact") ? shown.cancelledReason : null);
  const riskLine = shown?.cancelledReason?.startsWith("High Risk") ? shown.cancelledReason : standAside.warning;
  const forecast = forecastMove({
    symbol: asset,
    timeframe,
    source: origin,
    horizonBars,
    stale: feedStale,
    spreadPrice: spread,
    candles: candles.filter((c) => c.closed).map((c) => ({ t: c.t, open: c.open, high: c.high, low: c.low, close: c.close })),
  });
  const badge = open ? shown?.lifecycle ?? "SCAN" : loading ? "COLLECTING" : lifecycle === "IDLE" ? "ANALYZING" : lifecycle;
  const cf = shown?.confluence;

  return (
    <aside
      data-strategies={shown?.strategies?.length ?? 0}
      data-why={shown?.cancelledReason || shown?.reasons?.[0] || "none"}
      className="panel flex flex-col gap-3 p-4 lg:sticky lg:top-3 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="kicker">{open ? "Live signal" : tt("kicker")}</p>
        <Badge variant={badge === "READY" ? "accent" : badge === "SETTLING" ? "warn" : "muted"}>{badge}</Badge>
      </div>
      {open ? (
        <p className="text-xs text-fg">
          Paper {open.signal.direction} is open on the left. Entry {fmtPx(asset, open.signal.entryPrice)}. This side keeps scanning.
        </p>
      ) : null}
      <div
        className={cn(
          "rounded-md px-4 py-6 text-center",
          dir === "BUY" && "bg-call/10",
          dir === "SELL" && "bg-put/10",
          dir === "WAIT" && "panel-inset",
        )}
      >
        <p
          className={cn(
            "display text-6xl leading-none",
            dir === "BUY" && "text-call",
            dir === "SELL" && "text-put",
            dir === "WAIT" && "text-muted",
          )}
        >
          {dirLabel}
        </p>
        {dir === "WAIT" && (
          <p className="mt-3 text-sm text-fg">
            {loading
              ? `Loading ${asset} ${timeframe}…`
              : shown?.cancelledReason || "Scanned — no valid setup on this candle"}
          </p>
        )}
        <p className="quote mt-3 text-sm text-fg">
          {calibrated ? `${(p * 100).toFixed(1)}% calibrated` : `uncalibrated · n=${shown?.sampleSize ?? 0}`}
          {" · "}
          {(shown?.expectedValueR ?? 0).toFixed(2)}R scenario
        </p>
        <p className="mt-1 text-xs text-muted">
          {asset} {timeframe} · {origin}
          {lastClosed ? ` · candle ${new Date(lastClosed.t).toISOString()}` : ""}
          {lastClosed ? ` · source ${lastClosed.source}` : ""}
        </p>
        {riskLine ? <p className="mt-3 rounded-sm bg-put/15 px-2 py-2 text-sm text-put">{riskLine}</p> : null}
        <div className="mt-4 grid grid-cols-3 gap-2 text-left">
          {matrix.cells.map((cell) => (
            <div key={cell.label} className="panel-inset px-2 py-2">
              <p className="kicker">{cell.label}</p>
              <p className={cn("font-mono text-sm", cell.direction === "BUY" && "text-call", cell.direction === "SELL" && "text-put", cell.direction === "WAIT" && "text-muted")}>
                {cell.direction === "BUY" ? "LONG" : cell.direction === "SELL" ? "SHORT" : "WAIT"}
              </p>
              <p className="text-xs text-muted">{cell.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg">
          {matrix.strong && dir !== "WAIT" && !riskLine ? "Strong signal. 1H, 15M, and 5M agree." : "Not a strong signal. The three timeframes do not all agree."}
        </p>
        <div className="mt-3 text-left text-xs text-fg">
          <p className="kicker mb-1">Structure</p>
          <p>{smc.orderBlock}</p>
          <p className="mt-1">{smc.fvg}</p>
          <p className="mt-1">{smc.liquidity}</p>
        </div>
        <div className="mt-3 text-left">
          <div className="flex items-center justify-between gap-2">
            <p className="kicker">Move forecast</p>
            <select
              className="bg-transparent text-xs text-fg"
              value={horizonBars}
              onChange={(e) => setHorizonBars(Number(e.target.value))}
            >
              {HORIZON_CHOICES.map((n) => (
                <option key={n} value={n}>
                  next {n} candles
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-sm text-fg">
            {forecast.call} · {forecast.horizonBars} {forecast.timeframe} candles
          </p>
          <p className="mt-1 text-xs text-muted">
            {forecast.bandLowPips != null && forecast.bandHighPips != null
              ? `band ${forecast.bandLowPips.toFixed(1)} to ${forecast.bandHighPips.toFixed(1)} pips`
              : forecast.bandLowPercent != null && forecast.bandHighPercent != null
                ? `band ${forecast.bandLowPercent.toFixed(2)}% to ${forecast.bandHighPercent.toFixed(2)}%`
                : "no move band"}
            {" · "}
            {forecast.source}
            {forecast.lastClosedTs ? ` · ${new Date(forecast.lastClosedTs).toISOString()}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">Uses closed candles only; the current forming candle is excluded.</p>
          <p className="mt-1 text-xs text-muted">{forecast.note}</p>
          <p className="mt-1 text-xs text-subtle">{forecast.invalidation}</p>
        </div>
        <div className="mt-4 text-left text-xs text-muted">
          <p className="kicker">Scanner</p>
          <p className="mt-1 text-fg">
            {scan.label} · score {scan.score} · {scan.regime}
            {scan.rsi != null ? ` · RSI ${scan.rsi.toFixed(0)}` : ""}
          </p>
          <p className="mt-1">
            {scan.pivot != null ? `Pivot ${fmtPx(asset, scan.pivot)} · R1 ${fmtPx(asset, scan.r1 ?? scan.pivot)} · S1 ${fmtPx(asset, scan.s1 ?? scan.pivot)}` : "Levels not ready"}
          </p>
          <p className="mt-1">
            {riskBook.status === "Unknown"
              ? riskBook.why
              : `Paper book · 95% worst about ${riskBook.var95?.toFixed(2)}R · average of those ${(riskBook.cvar ?? 0).toFixed(2)}R · deepest hole ${riskBook.maxDd?.toFixed(2)}R`}
          </p>
          <p className="kicker mt-3">Jev</p>
          <p className="mt-1 text-fg">
            {jev.action} · {jev.note} · rule score, uncalibrated
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {jev.bots.map((bot) => (
              <p key={bot.name} className="text-muted">
                <span className="text-fg">{bot.name}</span> {bot.side} · {bot.status}. {bot.read}
              </p>
            ))}
          </div>
        </div>
        <p className="mt-1 font-mono text-xs text-muted">
          {tt("calib")}: {shown?.calibrationStatus ?? "none"}
        </p>
        {dir === "WAIT" && shown?.pendingDirection !== "WAIT" && shown?.pendingDirection && (
          <p className="mt-2 text-xs text-muted">Closed-bar plan {shown?.pendingDirection} — waiting live confirm</p>
        )}
        {dir !== "WAIT" && (
          <p className="mt-2 text-xs text-muted">
            Risk {(settings.riskPercent * 100).toFixed(2)}% · {tt("stake")}: {fmtUsd(shown?.recommendedStake ?? 0)}
          </p>
        )}
        {dir !== "WAIT" && (shown?.recommendedLots ?? 0) > 0 && (
          <p className="quote mt-2 text-sm">
            {shown!.recommendedLots.toFixed(shown!.recommendedLots < 0.1 ? 3 : 2)} lot · 1:{shown!.suggestedLeverage} · margin {fmtUsd(shown!.marginUsd)}
          </p>
        )}
      </div>

      {cf?.items?.length ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="kicker">Confluence</p>
            <p className="quote text-xs">
              {cf.score}/{cf.max} {cf.grade}
            </p>
          </div>
          <div className="mb-2 flex gap-1">
            {cf.items.map((item) => (
              <div key={item.name} className={cn("h-1 flex-1 rounded-full", item.ok ? "bg-call" : "bg-elevated")} title={item.detail} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
            {cf.items.map((item) => (
              <div key={item.name} className="text-center" title={item.detail}>
                <p className="kicker truncate">{item.name}</p>
                <p className={cn("font-mono text-xs", item.ok ? "text-call" : "text-muted")}>{item.ok ? "Y" : "N"}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <Row k={tt("entry")} v={fmtPx(asset, shown?.entryPrice || price)} />
        <Row k={tt("stop")} v={shown?.stopPrice ? fmtPx(asset, shown.stopPrice) : "—"} />
        <Row k={tt("target")} v={shown?.targetPrice ? fmtPx(asset, shown.targetPrice) : "—"} />
        <Row k={tt("spread")} v={fmtPx(asset, spread)} />
        <Row k={tt("regime")} v={regimeLabel(shown?.regime ?? "MIXED")} />
        <Row k="Session" v={shown?.session?.name ?? "—"} />
        <Row k="Structure" v={shown?.structure?.zone ?? "—"} />
        <Row k="Candle" v={shown?.candle?.best ? `${shown.candle.best.name}` : "—"} />
        <Row k={tt("quality")} v={`${Math.round((shown?.dataQuality ?? 1) * 100)}%`} />
        <Row k="Score" v="uncalibrated" />
        <Row k={tt("sample")} v={String(shown?.sampleSize ?? 0)} />
        <Row k={tt("age")} v={ageSec(shown?.ageMs ?? 0)} />
        <Row k="News" v={shown?.cancelledReason?.toLowerCase().includes("news") ? "blocked" : "clear"} />
      </dl>

      {(shown?.sampleSize ?? 0) > 0 && (shown?.sampleSize ?? 0) < 30 && (
        <p className="rounded-sm bg-warn/10 px-2 py-1.5 text-xs text-warn">{tt("lowSample")}</p>
      )}
      {shown?.synthetic && <p className="text-xs text-muted">{tt("synthetic")}</p>}

      <div>
        <p className="kicker mb-2">Strategies</p>
        <div className="grid gap-1.5">
          {(shown?.strategies.length ? shown.strategies : []).map((s) => (
            <div key={s.name} className="panel-inset px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">{s.name.replaceAll("_", " ")}</span>
                <span
                  className={cn(
                    "font-mono",
                    s.direction === "BUY" && "text-call",
                    s.direction === "SELL" && "text-put",
                    s.direction === "WAIT" && "text-muted",
                  )}
                >
                  {s.direction}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{s.reasons[0] || "—"}</p>
            </div>
          ))}
          {!shown?.strategies.length && <p className="text-xs text-muted">Strategies wait for closed candles.</p>}
        </div>
        <p className="kicker mb-1 mt-3">{tt("reasons")}</p>
        <ul className="space-y-0.5 text-xs">
          {(shown?.reasons.length ? shown.reasons : ["—"]).map((r) => (
            <li key={r} className="text-call">
              + {r}
            </li>
          ))}
        </ul>
        <p className="kicker mb-1 mt-2">{tt("against")}</p>
        <ul className="space-y-0.5 text-xs">
          {(shown?.against.length ? shown.against : shown?.cancelledReason ? [shown.cancelledReason] : ["—"]).map((r) => (
            <li key={r} className="text-put">
              − {r}
            </li>
          ))}
        </ul>
        {density === "advanced" && (
          <>
            <p className="kicker mb-1 mt-2">{tt("invalid")}</p>
            <p className="text-xs text-muted">{shown?.invalidation?.join(" · ") || "—"}</p>
          </>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex gap-2 bg-surface pt-2">
        {open ? (
          <Button className="flex-1" variant={manage?.action === "EXIT_EARLY" || manage?.action === "TIME_STOP" ? "put" : "secondary"} onClick={flatten}>
            Close ticket
          </Button>
        ) : (
          <Button className="flex-1" variant={dir === "SELL" ? "put" : "call"} disabled={dir === "WAIT" || loading} onClick={() => paper(true)}>
            {tt("paper")}
          </Button>
        )}
        <Button className="flex-1" variant="secondary" onClick={skip} disabled={!!open}>
          {tt("skip")}
        </Button>
      </div>
      {!open && dir === "WAIT" ? <p className="text-xs text-muted">Paper stays off until the badge says BUY or SELL.</p> : null}
      {sizeNote ? <p className="text-xs text-muted">{sizeNote}</p> : null}
    </aside>
  );
}

function TradeManager({
  manage,
  openDir,
  onFlatten,
}: {
  manage: TradeManage;
  openDir: "BUY" | "SELL" | "WAIT";
  onFlatten: () => void;
}) {
  const tone =
    manage.action === "EXIT_EARLY" || manage.action === "TIME_STOP"
      ? "text-put"
      : manage.action === "HOLD_FOR_MORE" || manage.action === "TRAIL"
        ? "text-call"
        : "text-fg";
  const tag =
    manage.action === "HOLD_FOR_MORE"
      ? "HOLD · more R"
      : manage.action === "EXIT_EARLY"
        ? "EXIT now"
        : manage.action === "TIME_STOP"
          ? "TIME STOP"
          : manage.action === "TRAIL"
            ? "TRAIL"
            : "HOLD";
  return (
    <div className="panel-inset p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="kicker">Open {openDir} · live desk</p>
        <span className={cn("font-mono text-xs", tone)}>{tag}</span>
      </div>
      <p className={cn("quote mt-2 text-2xl leading-none", manage.unrealizedR >= 0 ? "text-call" : "text-put")}>
        {manage.unrealizedR >= 0 ? "+" : ""}
        {manage.unrealizedR.toFixed(2)}R
      </p>
      <p className="mt-2 text-sm font-medium">{manage.headline}</p>
      <p className="mt-1 text-xs text-muted">{manage.detail}</p>
      <p className="quote mt-2 text-xs text-fg">{manage.holdLabel}</p>
      <p className="mt-1 font-mono text-xs text-muted">{manage.etaLabel}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg">
        <div
          className={cn("h-full rounded-full", manage.unrealizedR >= 0 ? "bg-call" : "bg-put")}
          style={{ width: `${Math.round(manage.progress * 100)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-subtle">
        <span>SL</span>
        <span>peak {manage.peakR.toFixed(2)}R</span>
        <span>TP</span>
      </div>
      {manage.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {manage.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}
      <Button className="mt-3 w-full" size="sm" variant="ghost" onClick={onFlatten}>
        Flatten at mark
      </Button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="kicker">{k}</dt>
      <dd className="quote text-xs text-fg">{v}</dd>
    </div>
  );
}
