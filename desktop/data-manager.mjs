import fs from "node:fs";
import path from "node:path";

/**
 * Quote buffer. The window reads memory. Disk gets a batch, not every tick.
 * @param {{ tape: { writeMany: (rows: { at: number, body: unknown }[]) => void, close?: () => void }, dataDir: string, flushMs?: number }} opts
 */
export function createDataManager(opts) {
  const flushMs = opts.flushMs ?? 15_000;
  /** @type {{ at: number, body: unknown } | null} */
  let latest = null;
  /** @type {{ at: number, body: unknown }[]} */
  let batch = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, flushMs);
  }

  function flush() {
    timer = null;
    const rows = batch;
    batch = [];
    if (rows.length) {
      try {
        opts.tape.writeMany(rows);
      } catch {
        /* keep serving the in-memory quote */
      }
    }
    if (!latest) return;
    try {
      fs.mkdirSync(opts.dataDir, { recursive: true });
      const destination = path.join(opts.dataDir, "candles.json");
      const temporary = `${destination}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ at: latest.at, snapshot: latest.body }), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, destination);
    } catch {
      /* the desk reads memory, not this file */
    }
  }

  return {
    /** @param {unknown} body */
    push(body) {
      const row = { at: Date.now(), body };
      latest = row;
      batch.push(row);
      if (batch.length > 64) batch = batch.slice(-64);
      schedule();
      return row;
    },
    latest() {
      return latest;
    },
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      opts.tape.close?.();
    },
  };
}
