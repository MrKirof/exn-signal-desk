import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ASSETS, APP_VERSION, MODEL_VERSION } from "@/lib/lab/constants";
import { t, type I18nKey } from "@/lib/lab/i18n";
import { bucketStats, groupPerf, longestLose, maxDrawdown, profitFactor, scoreOutcomes } from "@/lib/lab/metrics";
import { sequenceRisk } from "@/lib/lab/risk";
import { useLab } from "@/store/lab-store";
import { feedClaim } from "@/lib/lab/source-label";
import { fmtPct, fmtTime, fmtUsd, regimeLabel } from "./format";
import { AccountBox } from "./account-box";

function useT() {
  const lang = useLab((s) => s.settings.lang);
  return (k: I18nKey) => t(lang, k);
}

export function HealthPanel() {
  const tt = useT();
  const h = useLab((s) => s.health);
  const integ = useLab((s) => s.integrity);
  const last = useLab((s) => s.candles.at(-1));
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Stat
        label={tt("connected")}
        value={!h.connected ? tt("connecting") : h.source === "simulated" ? tt("simulatedTape") : "live"}
        ok={h.connected && h.source !== "simulated"}
      />
      <Stat label={tt("lastCandle")} value={last ? fmtTime(last.t) : "—"} />
      <Stat label={tt("interval")} value={h.interval} />
      <Stat label={tt("missing")} value={String(integ.missing)} ok={integ.missing === 0} />
      <Stat label={tt("duplicates")} value={String(integ.duplicates)} ok={integ.duplicates === 0} />
      <Stat label={tt("ooo")} value={String(integ.outOfOrder)} ok={integ.outOfOrder === 0} />
      <Stat label={tt("model")} value={h.modelLoaded ? MODEL_VERSION : "unloaded"} ok={h.modelLoaded} />
      <Stat label={tt("latency")} value={`${h.workerLatencyMs.toFixed(1)} ms`} />
      <Stat label={tt("news")} value={fmtTime(h.newsFreshAt || Date.now())} />
      <Stat label={tt("asset")} value={h.asset} />
      <Stat label="Desk" value="CFD / R" />
      <Stat label="Source" value={h.source} />
      {integ.reasons.length > 0 && (
        <p className="sm:col-span-2 text-xs text-muted">{integ.reasons.join(" · ")}</p>
      )}
    </section>
  );
}

export function RiskPanel() {
  const tt = useT();
  const risk = useLab((s) => s.risk);
  const settings = useLab((s) => s.settings);
  const toggleKill = useLab((s) => s.toggleKill);
  const requestResetRisk = useLab((s) => s.requestResetRisk);
  const dd = risk.peakEquity > 0 ? (risk.peakEquity - risk.equity) / risk.peakEquity : 0;
  const seq = sequenceRisk(settings.baseStake, settings.martingaleMult, settings.maxSteps, 0.85);
  const remain = Math.max(0, Math.ceil((risk.pauseUntil - Date.now()) / 1000));
  return (
    <section className="space-y-4">
      <AccountBox />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={tt("pnl")} value={fmtUsd(risk.dailyPnl)} ok={risk.dailyPnl >= 0} />
        <Stat label={tt("bankroll")} value={fmtUsd(risk.equity)} />
        <Stat label={tt("peak")} value={fmtUsd(risk.peakEquity)} />
        <Stat label={tt("dd")} value={fmtPct(-dd)} ok={dd < 0.08} />
        <Stat label={tt("streakW")} value={String(risk.consecutiveWins)} />
        <Stat label={tt("streakL")} value={String(risk.consecutiveLosses)} />
        <Stat label={tt("trades")} value={String(risk.dailyTrades)} />
        <Stat label={tt("step")} value={String(risk.progressionStep)} />
        <Stat label={tt("pause")} value={remain > 0 ? `${remain}s` : "off"} ok={remain === 0} />
        <Stat label={tt("kill")} value={risk.killed ? "ON" : "off"} ok={!risk.killed} />
        <Stat label={tt("budget")} value={fmtUsd(risk.remainingLossBudget)} />
        <Stat label="Daily lock" value={risk.dailyStopHit || risk.dailyTpHit ? "locked" : "open"} ok={!risk.dailyStopHit} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={toggleKill}>
          {risk.killed ? "Release kill-switch" : "Emergency kill-switch"}
        </Button>
        <Button variant="secondary" onClick={requestResetRisk}>
          {tt("resetRisk")}
        </Button>
      </div>
      {settings.martingaleEnabled && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          {tt("martingaleWarn")}
          <p className="mt-2 font-mono text-xs text-fg">
            Sequence risk: {seq.path.map((p) => `s${p.step} ${fmtUsd(p.stake)}`).join(" → ")} · all-lose {fmtUsd(seq.ruinIfAllLose)}
          </p>
        </div>
      )}
    </section>
  );
}

export function PerformancePanel() {
  const tt = useT();
  const outcomes = useLab((s) => s.outcomes);
  const model = useLab((s) => s.model);
  const buckets = bucketStats(outcomes);
  const decided = outcomes.filter((o) => o.kind !== "TIE");
  const wr = decided.length ? decided.filter((o) => o.kind === "WIN").length / decided.length : 0;
  const scores = scoreOutcomes(outcomes);
  const byAsset = groupPerf(outcomes, (o) => o.asset);
  const byRegime = groupPerf(outcomes, (o) => o.regime);
  const byHour = groupPerf(outcomes, (o) => new Date(o.settledAt).getUTCHours().toString().padStart(2, "0") + "h");
  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Win rate" value={fmtPct(wr).replace("+", "")} />
        <Stat label="Net" value={fmtUsd(outcomes.reduce((s, o) => s + o.grossProfit, 0))} />
        <Stat label="Profit factor" value={Number.isFinite(profitFactor(outcomes)) ? profitFactor(outcomes).toFixed(2) : "—"} />
        <Stat label="Max DD" value={fmtUsd(maxDrawdown(outcomes.map((o) => o.grossProfit)))} />
        <Stat label="Brier" value={scores.brier == null ? "—" : scores.brier.toFixed(3)} />
        <Stat label="Log loss" value={scores.logloss == null ? "—" : scores.logloss.toFixed(3)} />
        <Stat label="Longest lose" value={String(longestLose(outcomes))} />
        <Stat label="Holdout Brier" value={model.brierHoldout == null ? "n/a" : model.brierHoldout.toFixed(3)} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">{tt("buckets")}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.label} className="rounded-md border border-border bg-elevated p-3">
              <p className="text-xs text-muted">{b.label}</p>
              <p className="font-mono text-lg tabular-nums">{b.n ? `${(b.winRate * 100).toFixed(1)}%` : "—"}</p>
              <p className="text-xs text-subtle">n={b.n}</p>
              {b.n > 0 && b.n < 20 && <p className="mt-1 text-xs text-warn">{tt("lowSample")}</p>}
            </div>
          ))}
        </div>
      </div>
      <MiniTable title="By asset" rows={byAsset} />
      <MiniTable title="By regime" rows={byRegime} />
      <MiniTable title="By hour (UTC)" rows={byHour} />
    </section>
  );
}

export function BacktestPanel() {
  const tt = useT();
  const report = useLab((s) => s.backtestReport);
  const busy = useLab((s) => s.backtestBusy);
  const run = useLab((s) => s.runBacktest);
  const once = useRef(false);
  useEffect(() => {
    if (once.current || report || busy) return;
    once.current = true;
    run();
  }, [report, busy, run]);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Closed-candle signal, next-bar entry, instrument spread. Ambiguous SL+TP on the same bar = LOSS. Walk-forward folds.
        </p>
        <Button onClick={run} disabled={busy}>
          {busy ? "Running…" : tt("runBacktest")}
        </Button>
      </div>
      {!report && <p className="text-sm text-muted">{busy ? "Walking the book…" : "Run a walk-forward on the current book."}</p>}
      {report && (
        <>
          <p className="text-sm text-fg">{report.note}</p>
          {report.blocks.length > 0 && (
            <div className="panel p-3">
              <p className="kicker mb-2">Why candles were refused</p>
              <ul className="space-y-1 text-xs text-muted">
                {report.blocks.map((b) => (
                  <li key={b.reason}>
                    {b.n} · {b.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Bars" value={String(report.bars)} />
            <Stat label="Trades" value={String(report.trades)} />
            <Stat label="Win rate" value={`${(report.winRate * 100).toFixed(1)}%`} />
            <Stat label="Net" value={fmtUsd(report.netProfit)} />
            <Stat label="PF" value={Number.isFinite(report.profitFactor) ? report.profitFactor.toFixed(2) : "—"} />
            <Stat label="Max DD" value={fmtUsd(report.maxDrawdown)} />
            <Stat label="Expectancy R" value={report.expectancyR.toFixed(2)} />
            <Stat label="Leakage" value={report.leakageSafe ? "blocked" : "unsafe"} ok={report.leakageSafe} />
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-elevated text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Fold</th>
                  <th className="px-3 py-2 font-medium">WR</th>
                  <th className="px-3 py-2 font-medium">Brier</th>
                  <th className="px-3 py-2 font-medium">PnL</th>
                </tr>
              </thead>
              <tbody>
                {report.walkForward.map((f) => (
                  <tr key={f.fold} className="border-t border-border">
                    <td className="px-3 py-2">{f.fold}</td>
                    <td className="px-3 py-2 font-mono">{(f.wr * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{f.brier == null ? "—" : f.brier.toFixed(3)}</td>
                    <td className="px-3 py-2 font-mono">{fmtUsd(f.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MiniTable title="By strategy" rows={report.byStrategy} />
          <MiniTable title="By regime" rows={report.byRegime} />
        </>
      )}
    </section>
  );
}

export function JournalPanel() {
  const outcomes = useLab((s) => s.outcomes);
  const exportJournal = useLab((s) => s.exportJournal);
  const rows = [...outcomes].reverse().slice(0, 80);
  return (
    <section className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const blob = new Blob([exportJournal()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "exn-lab-journal.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-elevated text-muted">
            <tr>
              {["Time", "Asset", "Dir", "p", "R", "Result", "PnL", "Regime"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
                  No settled paper tickets yet.
                </td>
              </tr>
            )}
            {rows.map((o) => (
              <tr key={o.predictionId} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{fmtTime(o.settledAt)}</td>
                <td className="px-3 py-2">{o.asset}</td>
                <td className="px-3 py-2">{o.direction}</td>
                <td className="px-3 py-2 font-mono">{(o.calibratedProbability * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 font-mono">{o.outcomeR.toFixed(2)}</td>
                <td className={o.kind === "WIN" ? "px-3 py-2 text-call" : o.kind === "LOSS" ? "px-3 py-2 text-put" : "px-3 py-2"}>
                  {o.kind}
                  {o.ambiguousPath ? "*" : ""}
                </td>
                <td className="px-3 py-2 font-mono">{fmtUsd(o.grossProfit)}</td>
                <td className="px-3 py-2">{regimeLabel(o.regime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SettingsPanel() {
  const tt = useT();
  const settings = useLab((s) => s.settings);
  const patch = useLab((s) => s.patchSettings);
  const ack = useLab((s) => s.ackMartingale);
  const wipe = useLab((s) => s.wipe);
  const collectorLive = useLab((s) => s.collectorLive);
  const collectorDemo = useLab((s) => s.collectorDemo);
  const collectorToken = useLab((s) => s.collectorToken);
  const collectorListening = useLab((s) => s.collectorListening);
  const attachDemo = useLab((s) => s.attachDemoCollector);
  const detach = useLab((s) => s.detachCollector);
  const startListen = useLab((s) => s.startCollectorListen);
  const stopListen = useLab((s) => s.stopCollectorListen);
  const ingest = useLab((s) => s.ingestCollectorJson);
  const extensionSeen = useLab((s) => s.extensionSeen);
  const candles = useLab((s) => s.candles);
  const timeframe = useLab((s) => s.timeframe);
  const feedSymbol = useLab((s) => s.feedSymbol);
  const last = candles.length ? candles[candles.length - 1] : null;
  const ageSec = last ? Math.max(0, Math.round((Date.now() - last.t) / 1000)) : null;
  const healthSource = useLab((s) => s.health.source);
  const claim = feedClaim(healthSource, collectorDemo);
  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => useLab.setState({ toast: `${label} copied` }),
      () => useLab.setState({ toast: "Copy failed" }),
    );
  };

  return (
    <section className="grid max-w-3xl gap-5">
      <AccountBox />
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{tt("collector")}</h2>
          <Badge variant={collectorLive ? (claim.liveExness ? "call" : "warn") : extensionSeen ? "warn" : "muted"}>
            {collectorLive ? claim.text : extensionSeen ? "extension linked" : "public spot"}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted">{tt("collectorBody")}</p>
        <p className="mt-2 text-sm text-muted">Windows desktop app. The extension sends candles only to http://127.0.0.1:8090. Press Listen to show the token from this PC. Fixture data stays Fixture · test. Nothing is labeled Live Exness until a real terminal capture is verified. The extension does not place an order.</p>
        <p className="mt-2 font-mono text-xs text-subtle break-all">Local receiver http://127.0.0.1:8090</p>
        <p className="mt-1 font-mono text-xs text-subtle break-all">Token {collectorToken || "Press Listen inside the desktop app"}</p>
        <p className="mt-2 font-mono text-xs text-subtle break-all">
          {last
            ? `${claim.text} · ${feedSymbol || "—"} · ${timeframe} · ${new Date(last.t).toISOString()} · ${ageSec}s old · O ${last.open} H ${last.high} L ${last.low} C ${last.close}`
            : "No closed candle yet."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => copy("http://127.0.0.1:8090", "Local address")}>
            Copy address
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              startListen();
              window.setTimeout(() => {
                const token = useLab.getState().collectorToken;
                if (token) copy(token, "Token");
              }, 400);
            }}
          >
            Copy token
          </Button>
          {!collectorLive && (
            <Button size="sm" onClick={attachDemo}>
              {tt("collectorDemo")}
            </Button>
          )}
          {collectorLive && (
            <Button size="sm" variant="secondary" onClick={detach}>
              {tt("collectorDetach")}
            </Button>
          )}
          {!collectorListening ? (
            <Button size="sm" variant="secondary" onClick={startListen}>
              {tt("collectorListen")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={stopListen}>
              {tt("collectorStop")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const bridge = (window as Window & { exnDesktop?: { resetToken: () => Promise<string> } }).exnDesktop;
              if (!bridge) {
                useLab.setState({ toast: "Token reset is available in the desktop app." });
                return;
              }
              void bridge.resetToken().then((token) => {
                useLab.setState({ collectorToken: token, toast: "Pairing token reset. Paste the new token into the extension." });
              });
            }}
          >
            Reset token
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href="/exn-collector.zip" download>
              {tt("collectorDownload")}
            </a>
          </Button>
        </div>
        <label className="mt-3 block text-xs text-muted">
          Import snapshot JSON
          <Input
            className="mt-1"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((txt) => {
                try {
                  const err = ingest(JSON.parse(txt));
                  if (err) useLab.setState({ toast: err });
                } catch {
                  useLab.setState({ toast: "Invalid collector JSON" });
                }
              });
            }}
          />
        </label>
      </div>
      <p className="text-sm text-muted">{tt("privacy")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Risk % / trade">
          <Input
            type="number"
            step="0.05"
            value={(settings.riskPercent * 100).toFixed(2)}
            onChange={(e) => patch({ riskPercent: Math.max(0.05, Number(e.target.value)) / 100 })}
          />
        </Field>
        <Field label="Daily stop">
          <Input type="number" value={settings.dailyStopLoss} onChange={(e) => patch({ dailyStopLoss: Number(e.target.value) })} />
        </Field>
        <Field label="Daily take-profit">
          <Input type="number" value={settings.dailyTakeProfit} onChange={(e) => patch({ dailyTakeProfit: Number(e.target.value) })} />
        </Field>
        <Field label="Max trades / day">
          <Input type="number" value={settings.maxTradesDay} onChange={(e) => patch({ maxTradesDay: Number(e.target.value) })} />
        </Field>
        <Field label="Min EV (R)">
          <Input type="number" step="0.005" value={settings.minEv.toFixed(3)} onChange={(e) => patch({ minEv: Number(e.target.value) })} />
        </Field>
        <Field label="Safety margin">
          <Input type="number" step="0.005" value={settings.safetyMargin.toFixed(3)} onChange={(e) => patch({ safetyMargin: Number(e.target.value) })} />
        </Field>
        <Field label="Kelly fraction">
          <Input type="number" step="0.05" value={settings.kellyFraction} onChange={(e) => patch({ kellyFraction: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="grid gap-3">
        <Toggle label="Orders off — this desk is read only" checked={false} onCheckedChange={() => {}} />
        <Toggle label="News / blackout filter" checked={settings.newsFilter} onCheckedChange={(v) => patch({ newsFilter: v })} />
        <Toggle label="Separate OTC models" checked={settings.otcSeparate} onCheckedChange={(v) => patch({ otcSeparate: v })} />
        <Toggle
          label="Martingale (off by default)"
          checked={settings.martingaleEnabled}
          onCheckedChange={(v) => {
            if (v) ack(true);
            else ack(false);
          }}
        />
      </div>
      {settings.martingaleEnabled && <p className="text-sm text-warn">{tt("martingaleWarn")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => patch({ moneyMode: "flat" })}>
          Flat
        </Button>
        <Button variant="secondary" size="sm" onClick={() => patch({ moneyMode: "kelly" })}>
          Quarter Kelly
        </Button>
        <Button variant="secondary" size="sm" onClick={() => patch({ moneyMode: "compound" })}>
          Compound 1%
        </Button>
      </div>
      <p className="text-xs text-subtle">
        EXN {APP_VERSION} · model {MODEL_VERSION} · assets {ASSETS.map((a) => a.id).join(", ")}
      </p>
      <Button variant="danger" onClick={() => void wipe()}>
        Delete all personal data
      </Button>
    </section>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="panel p-3">
      <p className="kicker">{label}</p>
      <p className={`quote mt-1 text-lg ${ok === false ? "text-put" : ok === true ? "text-call" : "text-fg"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: Record<string, { n: number; wr: number; pnl: number }> }) {
  const entries = Object.entries(rows);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted">No observations yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-elevated text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">n</th>
                <th className="px-3 py-2 font-medium">WR</th>
                <th className="px-3 py-2 font-medium">PnL</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k} className="border-t border-border">
                  <td className="px-3 py-2">{k}</td>
                  <td className="px-3 py-2 font-mono">{v.n}</td>
                  <td className="px-3 py-2 font-mono">{(v.wr * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{fmtUsd(v.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2 shadow-[var(--shadow-panel)]">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
    </div>
  );
}

export { Badge };
