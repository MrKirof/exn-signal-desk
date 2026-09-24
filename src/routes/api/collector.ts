import { createFileRoute } from "@tanstack/react-router";
import { deskAuthed, ingestBars } from "@/lib/lab/desk-io";

type Bucket = { at: number; body: unknown };
const buckets = new Map<string, Bucket>();
const MAX = 80;
const TTL_MS = 90_000;
const MAX_BYTES = 700_000;

function tokenOf(url: URL, req: Request) {
  const q = url.searchParams.get("token") || "";
  const h = req.headers.get("x-desk-token") || req.headers.get("x-exn-token") || "";
  return (q || h).trim();
}

function bucketKey(url: URL, req: Request) {
  return tokenOf(url, req);
}

function gc() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now - v.at > TTL_MS) buckets.delete(k);
  }
  if (buckets.size > MAX) {
    const ordered = [...buckets.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of ordered.slice(0, buckets.size - MAX)) buckets.delete(k);
  }
}

async function readBody(req: Request) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return { ok: false as const, error: "payload too large" };
  const text = await req.text();
  if (text.length > MAX_BYTES) return { ok: false as const, error: "payload too large" };
  try {
    return { ok: true as const, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const, error: "invalid json" };
  }
}

export const Route = createFileRoute("/api/collector")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!deskAuthed(request.headers.get("x-desk-token"), null, url.searchParams.get("token"))) return Response.json({ ok: false, error: "pair required" }, { status: 401 });
        gc();
        const key = bucketKey(url, request);
        if (!key) return Response.json({ ok: false, error: "bad token" }, { status: 400 });
        const hit = buckets.get(key);
        if (!hit) return Response.json({ ok: true, snapshot: null });
        return Response.json({ ok: true, at: hit.at, snapshot: hit.body });
      },
      PUT: async ({ request }) => {
        const url = new URL(request.url);
        if (!deskAuthed(request.headers.get("x-desk-token"), null, url.searchParams.get("token"))) return Response.json({ ok: false, error: "pair required" }, { status: 401 });
        gc();
        const key = bucketKey(url, request);
        if (!key) return Response.json({ ok: false, error: "bad token" }, { status: 400 });
        const body = await readBody(request);
        if (!body.ok) return Response.json({ ok: false, error: body.error }, { status: 400 });
        buckets.set(key, { at: Date.now(), body: body.json });
        const snap = body.json as { bars?: { t: number; open: number; high: number; low: number; close: number; volume?: number }[]; asset?: string; timeframe?: string; hello?: boolean };
        if (!snap.hello && Array.isArray(snap.bars) && snap.bars.length > 0) {
          ingestBars(
            snap.bars.map((b) => ({
              t: b.t,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume || 0,
              asset: snap.asset || "EURUSD",
              timeframe: snap.timeframe || "1m",
              synthetic: false,
            })),
          );
        }
        return Response.json({ ok: true });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (!deskAuthed(request.headers.get("x-desk-token"), null, url.searchParams.get("token"))) return Response.json({ ok: false, error: "pair required" }, { status: 401 });
        gc();
        const key = bucketKey(url, request);
        if (!key) return Response.json({ ok: false, error: "bad token" }, { status: 400 });
        const body = await readBody(request);
        if (!body.ok) return Response.json({ ok: false, error: body.error }, { status: 400 });
        buckets.set(key, { at: Date.now(), body: body.json });
        const snap = body.json as { bars?: { t: number; open: number; high: number; low: number; close: number; volume?: number }[]; asset?: string; timeframe?: string; hello?: boolean };
        if (!snap.hello && Array.isArray(snap.bars) && snap.bars.length > 0) {
          ingestBars(
            snap.bars.map((b) => ({
              t: b.t,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume || 0,
              asset: snap.asset || "EURUSD",
              timeframe: snap.timeframe || "1m",
              synthetic: false,
            })),
          );
        }
        return Response.json({ ok: true });
      },
    },
  },
});
