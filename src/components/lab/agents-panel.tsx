import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { postDesk } from "@/lib/lab/layers/agents";
import type { DeskStatus } from "@/lib/lab/layers/agents";

export function AgentsPanel() {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [steps, setSteps] = useState<{ at: number; asset: string; direction: string; price: number; note: string }[]>([]);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");

  async function load() {
    const res = await fetch("/api/desk");
    const json = (await res.json()) as { ok: boolean; status?: DeskStatus };
    if (json.status) setStatus(json.status);
  }

  useEffect(() => {
    void load().catch(() => setErr("Desk agents are not answering"));
    const id = window.setInterval(() => void load().catch(() => {}), 5000);
    return () => window.clearInterval(id);
  }, []);

  async function replay() {
    const res = await fetch("/api/desk?replay=1");
    const json = (await res.json()) as { steps?: { at: number; asset: string; direction: string; price: number; note: string }[] };
    setSteps(json.steps ?? []);
    setStep(0);
    await load();
  }

  const s = status;
  return (
    <section className="grid max-w-3xl gap-4">
      <div className="panel p-4">
        <h2 className="text-sm font-medium">Agents</h2>
        <p className="mt-2 text-sm text-muted">These run in the desk server, not on the chart thread. Closing the window keeps them only if the tray app is still running.</p>
        {err ? <p className="mt-2 text-sm text-put">{err}</p> : null}
        <div className="mt-3 grid gap-2 text-sm">
          <p>Folder · {s?.dir || "the desk-data folder next to the app"}</p>
          <p className="text-xs text-muted">Closed papers, balance, and candles are files in that folder. They are not kept only inside the browser.</p>
          <p>Ingest · {s ? `${s.ingest.bars} bars · ${s.ingest.gaps} gaps · ${s.health.feed}` : "…"}</p>
          <p>Backup · {s?.backup.lastAt ? new Date(s.backup.lastAt).toLocaleString() : "not yet"}</p>
          <p>Runner · {s?.runner.note ?? "…"}</p>
          <p>Replay steps stored · {s?.replay.steps ?? 0}</p>
          <p>Calibration · {s?.calibration.enough ? `${s.calibration.report.length} buckets` : "fewer than 30 papers"}</p>
          <p>Walk-forward · {s ? `${s.walk.status}${s.walk.pick != null ? ` · gate ${s.walk.pick} not applied` : ""}` : "…"}</p>
          <p>Risk · {s?.risk.tripped ? s.risk.reasons.join(" · ") : "inside limits"} {s?.risk.masterOff ? "· master off" : ""}</p>
          <p>News · {s?.news.flag ?? "…"}</p>
          <p>Regression · {s?.regression.note ?? "…"}</p>
          <p>Plugins · {s?.plugins}</p>
          <p>Updates · {s?.updater.note}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setErr("The pairing token is shown in Settings inside the desktop app. This button does not fetch one.")}>Pairing token</Button>
          <Button size="sm" variant="secondary" onClick={() => postDesk({ action: "backup" })}>Backup now</Button>
          <Button size="sm" variant="secondary" onClick={() => window.open("/api/desk?report=1", "_blank")}>HTML report</Button>
          <Button size="sm" variant="secondary" onClick={() => postDesk({ action: "master", off: true, reason: "Manual master off" })}>Master off</Button>
          <Button size="sm" variant="ghost" onClick={() => postDesk({ action: "master", off: false })}>Master on</Button>
          <Button size="sm" variant="ghost" onClick={() => void replay()}>Refresh</Button>
        </div>
      </div>
      <div className="panel p-4">
        <h2 className="text-sm font-medium">Attribution</h2>
        <p className="mt-2 text-sm text-muted">Names are labels. A higher win rate on a small sample is not a new edge.</p>
        <div className="mt-3 grid gap-1 text-sm">
          {(s?.attribution ?? []).map((row) => (
            <p key={row.name}>{row.name} · n={row.n} · {(row.winRate * 100).toFixed(0)}% · {row.avgR.toFixed(2)}R</p>
          ))}
          {s && s.attribution.length === 0 ? <p className="text-muted">No closed papers yet.</p> : null}
        </div>
      </div>
      <div className="panel p-4">
        <h2 className="text-sm font-medium">Session replay</h2>
        <p className="mt-2 text-sm text-muted">{steps.length ? `${step + 1} / ${steps.length}` : "Paper a trade to store a step, then refresh."}</p>
        {steps[step] ? (
          <p className="mt-2 text-sm">{steps[step]!.asset} {steps[step]!.direction} @ {steps[step]!.price} · {steps[step]!.note}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" disabled={step <= 0} onClick={() => setStep((n) => Math.max(0, n - 1))}>Back</Button>
          <Button size="sm" variant="secondary" disabled={step >= steps.length - 1} onClick={() => setStep((n) => n + 1)}>Next</Button>
        </div>
      </div>
    </section>
  );
}
