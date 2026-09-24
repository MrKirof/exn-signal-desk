import { createFileRoute } from "@tanstack/react-router";
import type { AssetId } from "@/lib/lab/types";

const QUERY: Record<string, string> = {
  EURUSD: "EUR USD forex",
  GBPUSD: "GBP USD forex",
  USDJPY: "USD JPY forex",
  XAUUSD: "gold price XAUUSD",
  BTCUSD: "bitcoin price",
};

function clean(s: string) {
  return s
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function headlines(xml: string) {
  const out: { title: string; url: string; at: number }[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks) {
    const title = clean(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const url = clean(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
    const pub = clean(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
    const at = Date.parse(pub);
    if (!title) continue;
    out.push({ title, url, at: Number.isFinite(at) ? at : Date.now() });
    if (out.length >= 6) break;
  }
  return out;
}

export const Route = createFileRoute("/api/wire")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const asset = (new URL(request.url).searchParams.get("asset") ?? "EURUSD") as AssetId;
        const q = QUERY[asset] ?? "forex";
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: {
              accept: "application/rss+xml, application/xml, text/xml",
              "user-agent": "Mozilla/5.0",
            },
          });
          if (!res.ok) {
            return Response.json({ ok: false, online: false, headlines: [], error: `web ${res.status}` });
          }
          const xml = await res.text();
          return Response.json({ ok: true, online: true, source: "google-news", headlines: headlines(xml) });
        } catch (err) {
          const message = err instanceof Error ? err.message : "web unreachable";
          return Response.json({ ok: false, online: false, headlines: [], error: message });
        }
      },
    },
  },
});
