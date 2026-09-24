import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DESK_CONFIG,
  attribute,
  calibrate,
  dedupeBars,
  gapFill,
  htmlReport,
  riskTrip,
  walkForwardGate,
  type DeskBar,
  type DeskConfig,
  type DeskOutcome,
  type DeskStatus,
} from "./desk-logic.ts";

export type { DeskBar } from "./desk-logic.ts";

let pairUntil = 0;
let started = false;
let issuedToken = (process.env.DESK_TOKEN || "").trim();

export function sameOriginRequest(requestUrl: string, origin: string | null, secFetchSite: string | null) {
  if (secFetchSite === "same-origin") return true;
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

export function armPair(ms = 60_000) {
  if (!issuedToken) issuedToken = `exn_${crypto.randomBytes(16).toString("hex")}`;
  pairUntil = Date.now() + ms;
  return { until: pairUntil, token: issuedToken };
}

export function pairOpen() {
  return Date.now() < pairUntil;
}

/** Fail closed. Empty configured token or empty presented token never matches. Origin is not a credential. */
export function deskAuthed(header: string | null, _origin: string | null = null, query: string | null = null) {
  const need = issuedToken.trim();
  const got = (header || "").trim() || (query || "").trim();
  if (!need || !got || need.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(need), Buffer.from(got));
}

export function publicToken() {
  return issuedToken;
}

export function dataDir() {
  return process.env.DESK_DATA || path.join(process.cwd(), ".desk-data");
}

function ensure() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const note = path.join(dataDir(), "README.txt");
  if (!fs.existsSync(note)) {
    fs.writeFileSync(
      note,
      "Desk memory folder.\njournal.json = closed paper trades\nsettings.json = balance and risk\ncandles.json = last saved candles\noutcomes.json = short score rows\nbars.json = agent candles\n",
    );
  }
}

const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export function folderPath() {
  ensure();
  return dataDir();
}

export function writeFolderFile(name: string, value: unknown) {
  if (!FILE_NAME.test(name)) throw new Error("bad file");
  writeJson(name, value);
  return dataDir();
}

export function readFolderFile<T>(name: string, fallback: T): T {
  if (!FILE_NAME.test(name)) return fallback;
  return readJson(name, fallback);
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown) {
  ensure();
  fs.writeFileSync(path.join(dataDir(), name), JSON.stringify(value));
}

function key() {
  return crypto.createHash("sha256").update(issuedToken || "desk-local-only").digest();
}

export function seal(text: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function openSeal(payload: string) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function ingestBars(rows: DeskBar[]) {
  const prev = readJson<DeskBar[]>("bars.json", []);
  const step = rows[0]?.timeframe === "5m" ? 300_000 : rows[0]?.timeframe === "15m" ? 900_000 : 60_000;
  const filled = gapFill(dedupeBars([...prev, ...rows]), step);
  const kept = filled.bars.slice(-5000);
  writeJson("bars.json", kept);
  writeJson("ingest.json", { bars: kept.length, gaps: filled.gaps, lastAt: Date.now() });
  return { bars: kept.length, gaps: filled.gaps };
}

export function rememberOutcome(row: DeskOutcome) {
  const prev = readJson<DeskOutcome[]>("outcomes.json", []);
  prev.push(row);
  writeJson("outcomes.json", prev.slice(-2000));
}

export function rememberStep(step: { at: number; asset: string; direction: string; price: number; note: string }) {
  const prev = readJson<typeof step[]>("replay.json", []);
  const last = prev[prev.length - 1];
  if (last && last.direction === step.direction && last.asset === step.asset && step.at - last.at < 60_000) return;
  prev.push(step);
  writeJson("replay.json", prev.slice(-500));
}

export function saveOpen(ticket: unknown) {
  writeJson("open.json", { at: Date.now(), ticket });
}

export function loadOpen() {
  return readJson<{ at: number; ticket: unknown } | null>("open.json", null);
}

export function readConfig(): DeskConfig {
  return { ...DEFAULT_DESK_CONFIG, ...readJson<Partial<DeskConfig>>("config.json", {}) };
}

export function writeConfig(patch: Partial<DeskConfig>) {
  const next = { ...readConfig(), ...patch };
  writeJson("config.json", next);
  return next;
}

export function backupNow() {
  ensure();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const file = path.join(dataDir(), "backups", `journal-${stamp}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = {
    bars: readJson("bars.json", []),
    outcomes: readJson("outcomes.json", []),
    replay: readJson("replay.json", []),
    config: readConfig(),
  };
  fs.writeFileSync(file, seal(JSON.stringify(body)));
  writeJson("backup.json", { lastAt: Date.now(), file });
  return file;
}

export function exportPack() {
  const outcomes = readJson<DeskOutcome[]>("outcomes.json", []);
  const cfg = readConfig();
  const risk = { ...riskTrip(outcomes, cfg), masterOff: readJson("master.json", { off: false }).off };
  const html = htmlReport({
    title: "Desk paper report",
    calibration: calibrate(outcomes),
    attribution: attribute(outcomes),
    risk,
  });
  ensure();
  const file = path.join(dataDir(), "reports", "latest.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return { file, html };
}

export function importPack(sealed: string) {
  const body = JSON.parse(openSeal(sealed)) as { bars?: DeskBar[]; outcomes?: DeskOutcome[]; config?: Partial<DeskConfig> };
  if (body.bars) writeJson("bars.json", dedupeBars(body.bars).slice(-5000));
  if (body.outcomes) writeJson("outcomes.json", body.outcomes.slice(-2000));
  if (body.config) writeConfig(body.config);
  return { ok: true };
}

async function pollNews() {
  const url = "https://news.google.com/rss/search?q=forex+OR+CPI+OR+FOMC&hl=en-US&gl=US&ceid=US:en";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    const titles = [...text.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1] ?? "").slice(0, 8);
    const hot = titles.find((t) => /cpi|fomc|nfp|rate|fed|war/i.test(t));
    const flag = hot ? `High-impact headline: ${hot}` : "No high-impact headline in the latest headlines";
    writeJson("news.json", { lastAt: Date.now(), flag });
    return flag;
  } catch {
    const flag = "News feed did not answer";
    writeJson("news.json", { lastAt: Date.now(), flag });
    return flag;
  }
}

export async function tickDesk() {
  const cfg = readConfig();
  const outcomes = readJson<DeskOutcome[]>("outcomes.json", []);
  const ingest = readJson("ingest.json", { bars: 0, gaps: 0, lastAt: 0 });
  const stale = ingest.lastAt > 0 && Date.now() - ingest.lastAt > 20_000;
  const risk = riskTrip(outcomes, cfg);
  const master = readJson("master.json", { off: false, reason: "" });
  if (risk.tripped && !master.off) {
    writeJson("master.json", { off: true, reason: risk.reasons[0] ?? "Risk limit" });
    writeJson("notify.json", { title: "Desk risk limit", body: risk.reasons[0] ?? "Risk limit", at: Date.now() });
  }
  const prev = readJson("regression.json", { avg: 0, n: 0 });
  const closed = outcomes.filter((r) => r.kind !== "TIE");
  const avg = closed.length ? closed.reduce((s, r) => s + r.outcomeR, 0) / closed.length : 0;
  const regression = closed.length >= 10 && prev.n >= 10 && avg < prev.avg - 0.15
    ? `Average R fell from ${prev.avg.toFixed(2)} to ${avg.toFixed(2)}. This is a warning, not a new strategy.`
    : "No regression warning";
  writeJson("regression.json", { avg, n: closed.length });
  const walk = walkForwardGate(outcomes);
  const news = readJson("news.json", { lastAt: 0, flag: "News not polled yet" });
  if (Date.now() - news.lastAt > 10 * 60_000) void pollNews();
  const status: DeskStatus = {
    at: Date.now(),
    ingest: { ...ingest, stale },
    backup: readJson("backup.json", { lastAt: 0, file: "" }),
    runner: readJson("runner.json", { lastAt: 0, note: "Waiting for a posted signal" }),
    replay: { steps: readJson<unknown[]>("replay.json", []).length },
    calibration: calibrate(outcomes),
    attribution: attribute(outcomes),
    walk,
    risk: { ...risk, masterOff: readJson("master.json", { off: false }).off },
    news,
    health: { server: "up", feed: ingest.lastAt === 0 ? "empty" : stale ? "stale" : "fresh" },
    regression: { note: regression },
    plugins: "Third-party plugins are refused. Only the built-in readers run.",
    updater: {
      note: cfg.updateUrl ? `Update URL is set (${cfg.updateUrl}). This build does not download code by itself.` : "Auto-update is off. No release server is configured.",
    },
    notify: readJson("notify.json", null),
    config: cfg,
    dir: dataDir(),
  };
  writeJson("status.json", status);
  return status;
}

export function readReplay() {
  return readJson<{ at: number; asset: string; direction: string; price: number; note: string }[]>("replay.json", []);
}

export function readStatus() {
  return readJson<DeskStatus | null>("status.json", null);
}

export function postRunner(note: string) {
  writeJson("runner.json", { lastAt: Date.now(), note });
}

export function setMaster(off: boolean, reason = "") {
  writeJson("master.json", { off, reason });
}

export function takeNotify() {
  const note = readJson<{ title: string; body: string; at: number } | null>("notify.json", null);
  if (note) writeJson("notify.json", null);
  return note;
}

export function startDeskLoop() {
  if (started) return;
  started = true;
  void tickDesk();
  setInterval(() => void tickDesk(), 30_000);
  setInterval(() => {
    const backup = readJson("backup.json", { lastAt: 0 });
    if (Date.now() - backup.lastAt > 6 * 60 * 60_000) backupNow();
  }, 60_000);
}
