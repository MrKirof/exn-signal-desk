import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createDataManager } from "./data-manager.mjs";
import { ensureToken, prepareDesktopEnv, readToken, resetToken, verifyToken } from "./pair.mjs";
import { openTape } from "./tape.mjs";
import { acceptKey, decodeFrame, encodeFrame } from "./ws-frame.mjs";

const MAX_BYTES = 700_000;

/** @param {import("node:http").ServerResponse} res @param {number} code @param {unknown} body @param {string} [type] */
function send(res, code, body, type = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "content-type": type,
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-desk-token",
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
    "cache-control": "no-store",
  });
  res.end(text);
}

/** @param {import("node:http").IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on("data", (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

/** @param {string} file */
function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

/**
 * @param {{ port?: number, host?: string, dataDir: string, uiDir: string, zipPath?: string }} opts
 */
export async function startReceiver(opts) {
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1") return Promise.reject(new Error("Desktop receiver binds to 127.0.0.1 only"));
  prepareDesktopEnv(process.env);
  ensureToken(opts.dataDir);
  const uiDir = path.resolve(opts.uiDir);
  const tape = await openTape(opts.dataDir);
  const data = createDataManager({ tape, dataDir: opts.dataDir });
  let boundPort = opts.port ?? 8090;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${boundPort}`) {
        return send(res, 403, { ok: false, error: "Only the configured loopback host is accepted." });
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (url.pathname === "/api/order" || url.pathname === "/api/trade" || url.pathname === "/api/buy" || url.pathname === "/api/sell") {
        return send(res, 404, { ok: false, error: "This app does not place orders." });
      }
      if (url.pathname === "/api/health") {
        return send(res, 200, { ok: true, bind: "127.0.0.1", storage: tape.kind, stream: "websocket", databaseUrl: false, orders: false });
      }
      if (url.pathname === "/api/desk") {
        return send(res, 403, { ok: false, error: "This endpoint does not hand out a token." });
      }
      const header = req.headers["x-desk-token"];
      const presented = Array.isArray(header) ? header[0] : header || "";
      if (url.pathname === "/api/token/reset") {
        if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST required" });
        if (!verifyToken(opts.dataDir, presented)) return send(res, 401, { ok: false, error: "pair required" });
        const token = resetToken(opts.dataDir);
        return send(res, 200, { ok: true, token });
      }
      if (url.pathname === "/api/collector") {
        if (!verifyToken(opts.dataDir, presented)) return send(res, 401, { ok: false, error: "pair required" });
        if (req.method === "GET") {
          const latest = data.latest();
          return send(res, 200, { ok: true, at: latest?.at ?? 0, snapshot: latest?.body ?? null });
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = await readBody(req);
          data.push(body);
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { ok: false, error: "method" });
      }
      if (url.pathname === "/exn-collector.zip" && opts.zipPath && fs.existsSync(opts.zipPath)) {
        const buf = fs.readFileSync(opts.zipPath);
        res.writeHead(200, { "content-type": "application/zip", "content-length": buf.length, "cache-control": "no-store" });
        res.end(buf);
        return;
      }
      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^[/\\]+/, "");
      const file = path.resolve(uiDir, rel);
      if (file !== uiDir && !file.startsWith(uiDir + path.sep)) return send(res, 404, { ok: false, error: "not found" });
      if (req.method === "GET" && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const buf = fs.readFileSync(file);
        res.writeHead(200, { "content-type": contentType(file), "content-length": buf.length, "cache-control": "no-store" });
        res.end(buf);
        return;
      }
      const index = path.join(uiDir, "index.html");
      if (req.method === "GET" && fs.existsSync(index)) {
        const buf = fs.readFileSync(index);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": buf.length, "cache-control": "no-store" });
        res.end(buf);
        return;
      }
      return send(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "bad request";
      if (!res.headersSent) send(res, 400, { ok: false, error: message });
    }
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const key = req.headers["sec-websocket-key"];
    if (req.headers.host !== `127.0.0.1:${boundPort}` || url.pathname !== "/api/stream" || typeof key !== "string" || !key) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        acceptKey(key) +
        "\r\n\r\n",
    );
    let authed = false;
    /** @type {Buffer} */
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      if (!authed) socket.destroy();
    }, 3000);
    socket.on("data", (/** @type {Buffer} */ chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length) {
        const frame = decodeFrame(buf);
        if (!frame) return;
        buf = buf.subarray(frame.rest);
        if (frame.opcode === 8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 1) continue;
        let msg = null;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          socket.destroy();
          return;
        }
        if (!authed) {
          const token = msg && typeof msg === "object" ? String(msg.token || "") : "";
          if (!msg || msg.type !== "auth" || !verifyToken(opts.dataDir, token)) {
            socket.destroy();
            return;
          }
          authed = true;
          clearTimeout(timer);
          socket.write(encodeFrame(JSON.stringify({ ok: true })));
          continue;
        }
        data.push(msg);
      }
    });
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8090, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string" || addr.address !== "127.0.0.1") {
        server.close();
        reject(new Error("refused a non-loopback bind"));
        return;
      }
      boundPort = addr.port;
      resolve({ server, port: addr.port, token: readToken(opts.dataDir) });
    });
  });
}
