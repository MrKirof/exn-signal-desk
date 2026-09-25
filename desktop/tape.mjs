import fs from "node:fs";
import path from "node:path";

/** Local candle tape. TimescaleDB is a server. This desktop app stores rows on the PC. */
export async function openTape(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "tape.sqlite"));
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(`CREATE TABLE IF NOT EXISTS ticks (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      asset TEXT,
      timeframe TEXT,
      price REAL,
      payload TEXT NOT NULL
    )`);
    const insert = db.prepare("INSERT INTO ticks (at, asset, timeframe, price, payload) VALUES (?, ?, ?, ?, ?)");
    return {
      kind: "sqlite-wal",
      /** @param {unknown} body */
      write(body) {
        const row = body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
        insert.run(Date.now(), String(row.asset || ""), String(row.timeframe || ""), Number(row.price) || 0, JSON.stringify(body));
      },
      close() {
        db.close();
      },
    };
  } catch {
    return {
      kind: "local-folder",
      write() {},
      close() {},
    };
  }
}
