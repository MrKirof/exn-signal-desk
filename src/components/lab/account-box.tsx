import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLab } from "@/store/lab-store";
import { fmtUsd } from "./format";
import { cn } from "@/lib/utils";

const PRESETS = [200, 500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000];
const LEVS = [20, 50, 100, 200, 500, 1000, 2000];

export function AccountBox({ compact = false }: { compact?: boolean }) {
  const settings = useLab((s) => s.settings);
  const signal = useLab((s) => s.signal);
  const patch = useLab((s) => s.patchSettings);
  const setView = useLab((s) => s.setView);
  const [draft, setDraft] = useState(String(Math.round(settings.bankroll)));

  useEffect(() => {
    setDraft(String(Math.round(settings.bankroll)));
  }, [settings.bankroll]);

  const commit = () => {
    const n = Number(String(draft).replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 10) return;
    if (Math.abs(n - settings.bankroll) < 0.005) return;
    patch({ bankroll: Math.round(n * 100) / 100 });
  };

  const lots = signal?.recommendedLots ?? 0;
  const lev = signal?.suggestedLeverage ?? 0;
  const margin = signal?.marginUsd ?? 0;
  const notion = signal?.notionalUsd ?? 0;
  const sizeNote = useLab((s) => s.sizeNote);
  const memoryTrades = useLab((s) => s.memoryTrades);
  const memoryBytes = useLab((s) => s.memoryBytes);
  const kb = memoryBytes > 0 ? `${Math.max(1, Math.round(memoryBytes / 1024))} KB on this PC` : "saving on this PC";

  if (compact) {
    return (
      <button
        type="button"
        className="hidden rounded-sm border border-border px-2 py-1 text-left md:block"
        onClick={() => setView("settings")}
        title="Set account balance"
      >
        <p className="kicker">Balance</p>
        <p className="quote text-sm leading-none">{fmtUsd(settings.bankroll)}</p>
      </button>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="kicker">Account</p>
        <p className="font-mono text-xs text-muted">risk {(settings.riskPercent * 100).toFixed(2)}% / trade</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[140px] flex-1">
          <span className="kicker">Balance (USD)</span>
          <Input
            className="mt-1"
            type="number"
            min={10}
            step={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </label>
        <Button size="sm" onClick={commit}>
          Set
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            className={cn("seg-btn h-8 px-2", Math.abs(settings.bankroll - n) < 0.5 && "bg-elevated text-fg")}
            data-on={Math.abs(settings.bankroll - n) < 0.5 ? "true" : "false"}
            onClick={() => patch({ bankroll: n })}
          >
            {n >= 1000 ? `${n / 1000}k` : n}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <p className="kicker">Broker max leverage</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {LEVS.map((n) => (
            <button
              key={n}
              type="button"
              className="seg-btn h-8 px-2"
              data-on={settings.leverageCap === n ? "true" : "false"}
              onClick={() => patch({ leverageCap: n })}
            >
              1:{n}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Hint k="Lots" v={lots > 0 ? lots.toFixed(lots < 0.1 ? 3 : 2) : "—"} />
        <Hint k="Leverage" v={lev > 0 ? `1:${lev}` : "—"} />
        <Hint k="Margin" v={margin > 0 ? fmtUsd(margin) : "—"} />
        <Hint k="Notional" v={notion > 0 ? fmtUsd(notion) : "—"} />
      </div>
      {sizeNote ? <p className="mt-2 text-xs text-muted">{sizeNote}</p> : null}
      <p className="mt-2 text-xs text-subtle">
        Memory · {memoryTrades} closed trades · {kb}. Next signal uses this history.
      </p>
      <p className="mt-2 text-xs text-subtle">
        Lots from { (settings.riskPercent * 100).toFixed(2) }% of balance vs this stop. Leverage is the lowest step that keeps margin near 8% of equity — not a call to use max leverage.
      </p>
    </div>
  );
}

function Hint({ k, v }: { k: string; v: string }) {
  return (
    <div className="panel-inset px-2 py-1.5">
      <p className="kicker">{k}</p>
      <p className="quote text-sm">{v}</p>
    </div>
  );
}
