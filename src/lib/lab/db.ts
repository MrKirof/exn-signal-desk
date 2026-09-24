import { DB_NAME, DB_VERSION, RETENTION_CANDLES } from "./constants.ts";
import type { BookRow } from "./book.ts";
import type { Candle, ModelRecord, NewsEvent, Outcome, Signal } from "./types.ts";

const STORES = [
  "candles",
  "predictions",
  "outcomes",
  "sessions",
  "models",
  "metrics",
  "newsEvents",
  "auditLogs",
  "operations",
] as const;

type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

export function idbAvailable() {
  return typeof indexedDB !== "undefined";
}

export function openLabDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null);
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("candles")) {
        const s = db.createObjectStore("candles", { keyPath: "key" });
        s.createIndex("asset_tf_t", ["asset", "timeframe", "t"], { unique: true });
      }
      if (!db.objectStoreNames.contains("predictions")) {
        const s = db.createObjectStore("predictions", { keyPath: "predictionId" });
        s.createIndex("asset_t", ["asset", "createdAt"]);
      }
      if (!db.objectStoreNames.contains("outcomes")) {
        const s = db.createObjectStore("outcomes", { keyPath: "predictionId" });
        s.createIndex("settledAt", "settledAt");
      }
      if (!db.objectStoreNames.contains("operations")) {
        db.createObjectStore("operations", { keyPath: "id" });
      }
      for (const name of ["sessions", "models", "metrics", "newsEvents", "auditLogs"] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  });
  return dbp;
}

function candleKey(c: Candle) {
  return `${c.asset}|${c.timeframe}|${c.t}`;
}

export async function putCandles(candles: Candle[]) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("candles", "readwrite");
  const store = tx.objectStore("candles");
  for (const c of candles.slice(-RETENTION_CANDLES)) {
    store.put({ ...c, key: candleKey(c) });
  }
  await done(tx);
}

export async function putPrediction(s: Signal) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("predictions", "readwrite");
  tx.objectStore("predictions").put(s);
  await done(tx);
}

export async function putOperation(row: BookRow) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("operations", "readwrite");
  tx.objectStore("operations").put(row);
  await done(tx);
}

export async function loadOperations(limit = 80): Promise<BookRow[]> {
  const db = await openLabDb();
  if (!db || !db.objectStoreNames.contains("operations")) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("operations", "readonly");
    const req = tx.objectStore("operations").getAll();
    req.onsuccess = () => {
      const rows = (req.result as BookRow[]).sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1));
      resolve(rows.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putOutcome(o: Outcome) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("outcomes", "readwrite");
  tx.objectStore("outcomes").put(o);
  await done(tx);
}

export async function putModel(m: ModelRecord) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("models", "readwrite");
  tx.objectStore("models").put({ ...m, id: m.version });
  await done(tx);
}

export async function loadModel(): Promise<ModelRecord | null> {
  const db = await openLabDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("models", "readonly");
    const req = tx.objectStore("models").getAll();
    req.onsuccess = () => {
      const rows = req.result as ModelRecord[];
      const champ = rows.find((m) => m.champion) ?? rows[0];
      resolve(champ ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadCandles(asset: string, timeframe: string, limit = 800): Promise<Candle[]> {
  const db = await openLabDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("candles", "readonly");
    const req = tx.objectStore("candles").getAll();
    req.onsuccess = () => {
      const rows = (req.result as (Candle & { key?: string })[])
        .filter((c) => c.asset === asset && c.timeframe === timeframe)
        .sort((a, b) => a.t - b.t)
        .slice(-limit)
        .map(({ key: _key, ...c }) => c);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function pinMemory() {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* browser may refuse; data still stays until the profile clears it */
  }
}

export async function loadOutcomes(limit = 2000): Promise<Outcome[]> {
  const db = await openLabDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("outcomes", "readonly");
    const req = tx.objectStore("outcomes").getAll();
    req.onsuccess = () => {
      const rows = (req.result as Outcome[]).sort((a, b) => a.settledAt - b.settledAt);
      resolve(rows.slice(-limit));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function usageEstimate(): Promise<number> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return 0;
  const e = await navigator.storage.estimate();
  return e.usage ?? 0;
}

export async function wipePersonal() {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction(STORES as unknown as string[], "readwrite");
  for (const name of STORES) tx.objectStore(name).clear();
  await done(tx);
}

export function exportJson(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const head = keys.join(",");
  const body = rows
    .map((r) => keys.map((k) => jsonCell(r[k])).join(","))
    .join("\n");
  return `${head}\n${body}`;
}

function jsonCell(v: unknown) {
  if (v == null) return "";
  const s = String(v).replaceAll('"', '""');
  return `"${s}"`;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putNews(events: NewsEvent[]) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("newsEvents", "readwrite");
  for (const e of events) tx.objectStore("newsEvents").put(e);
  await done(tx);
}

export async function rememberPlaybook(rules: readonly string[]) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("auditLogs", "readwrite");
  tx.objectStore("auditLogs").put({ id: "playbook", t: Date.now(), event: "playbook", extra: { rules } });
  await done(tx);
}

export async function audit(event: string, extra?: Record<string, unknown>) {
  const db = await openLabDb();
  if (!db) return;
  const tx = db.transaction("auditLogs", "readwrite");
  tx.objectStore("auditLogs").put({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(),
    event,
    extra: extra ?? {},
  });
  await done(tx);
}
