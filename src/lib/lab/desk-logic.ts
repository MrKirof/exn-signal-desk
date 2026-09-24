export interface DeskBar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  asset: string;
  timeframe: string;
  synthetic: boolean;
}

export interface DeskOutcome {
  strategy: string;
  kind: "WIN" | "LOSS" | "TIE";
  outcomeR: number;
  calibratedProbability: number;
  settledAt: number;
}

export interface DeskConfig {
  autostart: boolean;
  telemetry: boolean;
  dailyLossR: number;
  maxDrawdownR: number;
  lossStreak: number;
  updateUrl: string;
}

export const DEFAULT_DESK_CONFIG: DeskConfig = {
  autostart: false,
  telemetry: false,
  dailyLossR: 3,
  maxDrawdownR: 6,
  lossStreak: 4,
  updateUrl: "",
};

export function barKey(b: DeskBar) {
  return `${b.asset}|${b.timeframe}|${b.t}`;
}

export function dedupeBars(rows: DeskBar[]): DeskBar[] {
  const map = new Map<string, DeskBar>();
  for (const row of rows) {
    if (!(row.t > 0) || !(row.close > 0)) continue;
    map.set(barKey(row), row);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function gapFill(rows: DeskBar[], stepMs: number): { bars: DeskBar[]; gaps: number } {
  const sorted = dedupeBars(rows);
  if (sorted.length < 2 || !(stepMs > 0)) return { bars: sorted, gaps: 0 };
  const out: DeskBar[] = [];
  let gaps = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    out.push(cur);
    const next = sorted[i + 1];
    if (!next || next.asset !== cur.asset || next.timeframe !== cur.timeframe) continue;
    const missing = Math.round((next.t - cur.t) / stepMs) - 1;
    if (missing <= 0 || missing > 20) continue;
    for (let k = 1; k <= missing; k++) {
      gaps += 1;
      out.push({
        ...cur,
        t: cur.t + k * stepMs,
        open: cur.close,
        high: cur.close,
        low: cur.close,
        close: cur.close,
        volume: 0,
        synthetic: true,
      });
    }
  }
  return { bars: out.sort((a, b) => a.t - b.t), gaps };
}

export function calibrate(rows: DeskOutcome[]) {
  const buckets = new Map<number, { n: number; wins: number }>();
  for (const row of rows) {
    if (row.kind === "TIE") continue;
    const p = Math.round(Math.max(0, Math.min(1, row.calibratedProbability)) * 10) / 10;
    const b = buckets.get(p) ?? { n: 0, wins: 0 };
    b.n += 1;
    if (row.kind === "WIN") b.wins += 1;
    buckets.set(p, b);
  }
  const report = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, b]) => ({
      said: p,
      n: b.n,
      won: b.n ? b.wins / b.n : 0,
    }));
  return { report, n: rows.length, enough: rows.filter((r) => r.kind !== "TIE").length >= 30 };
}

export function attribute(rows: DeskOutcome[]) {
  const map = new Map<string, { n: number; wins: number; r: number }>();
  for (const row of rows) {
    if (row.kind === "TIE") continue;
    const name = row.strategy || "unknown";
    const b = map.get(name) ?? { n: 0, wins: 0, r: 0 };
    b.n += 1;
    b.r += row.outcomeR;
    if (row.kind === "WIN") b.wins += 1;
    map.set(name, b);
  }
  return [...map.entries()]
    .map(([name, b]) => ({ name, n: b.n, winRate: b.n ? b.wins / b.n : 0, avgR: b.n ? b.r / b.n : 0 }))
    .sort((a, b) => b.n - a.n);
}

export function riskTrip(rows: DeskOutcome[], cfg: DeskConfig, now = Date.now()) {
  const day = rows.filter((r) => now - r.settledAt < 24 * 60 * 60_000 && r.kind !== "TIE");
  const dailyR = day.reduce((s, r) => s + r.outcomeR, 0);
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.kind === "TIE") continue;
    if (rows[i]!.kind !== "LOSS") break;
    streak += 1;
  }
  let peak = 0;
  let eq = 0;
  let hole = 0;
  for (const row of rows) {
    if (row.kind === "TIE") continue;
    eq += row.outcomeR;
    peak = Math.max(peak, eq);
    hole = Math.max(hole, peak - eq);
  }
  const reasons: string[] = [];
  if (-dailyR >= cfg.dailyLossR) reasons.push(`Daily loss ${dailyR.toFixed(2)}R hit the ${cfg.dailyLossR}R limit`);
  if (hole >= cfg.maxDrawdownR) reasons.push(`Drawdown ${hole.toFixed(2)}R hit the ${cfg.maxDrawdownR}R limit`);
  if (streak >= cfg.lossStreak) reasons.push(`${streak} losses in a row`);
  return { tripped: reasons.length > 0, reasons, dailyR, streak, hole };
}

export function walkForwardGate(rows: DeskOutcome[], gates = [0.52, 0.54, 0.56]) {
  const usable = rows.filter((r) => r.kind === "WIN" || r.kind === "LOSS");
  const mid = Math.floor(usable.length / 2);
  const inn = usable.slice(0, mid);
  const out = usable.slice(mid);
  if (inn.length < 8 || out.length < 8) return { status: "too few" as const, pick: null, inR: null, outR: null };
  let best = gates[0]!;
  let bestR = -Infinity;
  for (const gate of gates) {
    const take = inn.filter((r) => r.calibratedProbability >= gate);
    const avg = take.length ? take.reduce((s, r) => s + r.outcomeR, 0) / take.length : -Infinity;
    if (avg > bestR) {
      bestR = avg;
      best = gate;
    }
  }
  const oos = out.filter((r) => r.calibratedProbability >= best);
  const outR = oos.length ? oos.reduce((s, r) => s + r.outcomeR, 0) / oos.length : 0;
  return {
    status: outR > 0 ? ("holds out of sample" as const) : ("in-sample only" as const),
    pick: best,
    inR: Number.isFinite(bestR) ? bestR : 0,
    outR,
    applied: false,
  };
}

export function htmlReport(opts: { title: string; calibration: ReturnType<typeof calibrate>; attribution: ReturnType<typeof attribute>; risk: ReturnType<typeof riskTrip> }) {
  const rows = opts.attribution
    .map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${a.n}</td><td>${(a.winRate * 100).toFixed(0)}%</td><td>${a.avgR.toFixed(2)}</td></tr>`)
    .join("");
  const cal = opts.calibration.report
    .map((c) => `<li>Said ${(c.said * 100).toFixed(0)}% · n=${c.n} · won ${(c.won * 100).toFixed(0)}%</li>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>body{font:14px system-ui;background:#14170f;color:#ece7dc;margin:32px}table{border-collapse:collapse}td,th{border-bottom:1px solid #2a2e38;padding:6px 10px;text-align:left}</style>
</head><body><h1>${escapeHtml(opts.title)}</h1>
<p>This is a paper journal report. It is not a live edge.</p>
<p>${opts.risk.tripped ? escapeHtml(opts.risk.reasons.join(" · ")) : "Risk limits not hit."}</p>
<h2>Calibration</h2>${opts.calibration.enough ? `<ul>${cal}</ul>` : "<p>Fewer than 30 closed papers. No calibration claim.</p>"}
<h2>Who was right, by name</h2><table><tr><th>Name</th><th>n</th><th>Win rate</th><th>Avg R</th></tr>${rows || "<tr><td colspan=4>No closed papers</td></tr>"}</table>
</body></html>`;
}

function escapeHtml(s: string) {
  return s.split("&").join("&" + "amp;").split("<").join("&" + "lt;").split(">").join("&" + "gt;");
}

export interface DeskStatus {
  at: number;
  ingest: { bars: number; gaps: number; lastAt: number; stale: boolean };
  backup: { lastAt: number; file: string };
  runner: { lastAt: number; note: string };
  replay: { steps: number };
  calibration: ReturnType<typeof calibrate>;
  attribution: ReturnType<typeof attribute>;
  walk: ReturnType<typeof walkForwardGate>;
  risk: ReturnType<typeof riskTrip> & { masterOff: boolean };
  news: { lastAt: number; flag: string };
  health: { server: "up"; feed: "fresh" | "stale" | "empty" };
  regression: { note: string };
  plugins: string;
  updater: { note: string };
  notify: { title: string; body: string; at: number } | null;
  config: DeskConfig;
  dir: string;
}

