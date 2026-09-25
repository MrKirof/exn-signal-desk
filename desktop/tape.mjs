import fs from "node:fs";
import path from "node:path";

/** Local candle tape. Writes are batched by the data manager, not by the window. */
export async function openTape(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "tape.sqlite"));
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA synchronous=NORMAL;");
    db.exec("PRAGMA temp_store=MEMORY;");
    db.exec("PRAGMA cache_size=-2000;");
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
      /** @param {{ at: number, body: unknown }[]} rows */
      writeMany(rows) {
        if (!rows.length) return;
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const row of rows) {
            const body = row && row.body && typeof row.body === "object" ? /** @type {Record<string, unknown>} */ (row.body) : {};
            insert.run(row.at, String(body.asset || ""), String(body.timeframe || ""), Number(body.price) || 0, JSON.stringify(row.body));
          }
          db.exec("COMMIT");
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            /* the failed batch is dropped, the live quote stays in memory */
          }
          throw err;
        }
      },
      close() {
        db.close();
      },
    };
  } catch {
    return {
      kind: "local-folder",
      writeMany() {},
      close() {},
    };
  }
}
