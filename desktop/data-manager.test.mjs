import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDataManager } from "./data-manager.mjs";

test("quotes are readable before the disk batch is written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exn-data-"));
  /** @type {{ at: number, body: unknown }[][]} */
  const writes = [];
  const manager = createDataManager({
    dataDir: dir,
    flushMs: 40,
    tape: {
      writeMany(rows) {
        writes.push(rows);
      },
    },
  });
  manager.push({ asset: "EURUSD", price: 1.1 });
  manager.push({ asset: "EURUSD", price: 1.2 });
  assert.equal(manager.latest()?.body && /** @type {{ price: number }} */ (manager.latest().body).price, 1.2);
  assert.equal(writes.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 2);
  manager.close();
});
