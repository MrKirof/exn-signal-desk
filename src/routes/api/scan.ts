import { createFileRoute } from "@tanstack/react-router";
import { parseBreadth, parseFinviz, parseMessari } from "@/lib/lab/scan";

const FINVIZ = "https://finviz.com/screener?v=111&s=ta_topgainers";
const FINVIZ_HOME = "https://finviz.com/";
const MESSARI = "https://api.messari.io/metrics/v2/assets?pageSize=8";

async function yahooTape() {
  const gainersUrl =
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=8";
  const summaryUrl = "https://query1.finance.yahoo.com/v6/finance/quote/marketSummary?lang=en-US&region=US";
  const [gainersRes, summaryRes] = await Promise.all([
    pull(gainersUrl, "application/json"),
    pull(summaryUrl, "application/json"),
  ]);
  const gainersBody = (await gainersRes.json()) as {
    finance?: { result?: { quotes?: { symbol?: string; shortName?: string; regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketVolume?: number }[] }[] };
  };
  const quotes = gainersBody.finance?.result?.[0]?.quotes ?? [];
  const finviz = quotes.slice(0, 8).map((q) => ({
    ticker: q.symbol ?? "—",
    name: q.shortName ?? q.symbol ?? "—",
    price: q.regularMarketPrice != null ? q.regularMarketPrice.toFixed(2) : "—",
    change: q.regularMarketChangePercent != null ? `${q.regularMarketChangePercent.toFixed(2)}%` : "—",
    volume: q.regularMarketVolume != null ? String(q.regularMarketVolume) : "—",
  }));
  const summary = (await summaryRes.json()) as {
    marketSummaryResponse?: { result?: { symbol?: string; shortName?: string; regularMarketChangePercent?: { raw?: number; fmt?: string } }[] };
  };
  const rows = summary.marketSummaryResponse?.result ?? [];
  const sp = rows.find((row) => row.symbol === "ES=F") ?? rows[0];
  const raw = sp?.regularMarketChangePercent?.raw ?? 0;
  const tape = sp ? `${sp.shortName ?? sp.symbol} ${sp.regularMarketChangePercent?.fmt ?? ""}`.trim() : "Index tape unavailable";
  const mood = raw <= -0.35 ? "risk-off" : raw >= 0.35 ? "risk-on" : "mixed";
  return { finviz, tape, mood: mood as "risk-off" | "risk-on" | "mixed" };
}

let cache: { at: number; body: Record<string, unknown> } | null = null;

async function pull(url: string, accept: string) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { accept, "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res;
}

export const Route = createFileRoute("/api/scan")({
  server: {
    handlers: {
      GET: async () => {
        const now = Date.now();
        if (cache && now - cache.at < 20_000) return Response.json(cache.body);
        const started = now;
        const [stocks, coins, breadth, yahoo] = await Promise.all([
          pull(FINVIZ, "text/html")
            .then((r) => r.text())
            .then((html) => parseFinviz(html))
            .catch((err: unknown) => (err instanceof Error ? err.message : "finviz down")),
          pull(MESSARI, "application/json")
            .then((r) => r.json())
            .then((body) => parseMessari(body))
            .catch((err: unknown) => (err instanceof Error ? err.message : "messari down")),
          pull(FINVIZ_HOME, "text/html")
            .then((r) => r.text())
            .then((html) => parseBreadth(html))
            .catch(() => ({ advancing: null, declining: null, mood: "unknown" as const })),
          yahooTape().catch(() => null),
        ]);
        const stockRows = Array.isArray(stocks) && stocks.length > 0 ? stocks : (yahoo?.finviz ?? []);
        const mood = breadth.mood !== "unknown" ? breadth.mood : (yahoo?.mood ?? "unknown");
        const body = {
          ok: stockRows.length > 0 || (Array.isArray(coins) && coins.length > 0),
          ms: Date.now() - started,
          finviz: stockRows,
          finvizError: stockRows.length > 0 ? null : Array.isArray(stocks) ? "no rows" : stocks,
          messari: Array.isArray(coins) ? coins : [],
          messariError: Array.isArray(coins) ? null : coins,
          advancing: breadth.advancing,
          declining: breadth.declining,
          mood,
          tape: yahoo?.tape ?? null,
          source: Array.isArray(stocks) && stocks.length > 0 ? "finviz" : yahoo ? "yahoo" : "none",
          invo: "Invo is a login-only copy-trade app. It does not publish a public tape.",
        };
        cache = { at: Date.now(), body };
        return Response.json(body);
      },
    },
  },
});
