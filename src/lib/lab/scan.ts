export interface StockScan {
  ticker: string;
  name: string;
  price: string;
  change: string;
  volume: string;
}

export interface CoinScan {
  symbol: string;
  name: string;
  rank: number;
  sector: string;
}

function text(cell: string) {
  return cell.replace(/<[^>]+>/g, " ").replace(/&/g, "&").replace(/\s+/g, " ").trim();
}

export function parseFinviz(html: string): StockScan[] {
  const rows = html.match(/<tr class="styled-row[\s\S]*?<\/tr>/g) ?? [];
  const out: StockScan[] = [];
  for (const row of rows) {
    const ticker = row.match(/class="tab-link">([A-Z0-9.-]+)<\/a>/)?.[1];
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(text);
    if (!ticker || cells.length < 11) continue;
    out.push({
      ticker,
      name: cells[2] || ticker,
      price: cells[8] || "—",
      change: cells[9] || "—",
      volume: cells[10] || "—",
    });
    if (out.length >= 12) break;
  }
  return out;
}

export type MarketMood = "risk-off" | "risk-on" | "mixed" | "unknown";

export function parseBreadth(html: string): { advancing: number | null; declining: number | null; mood: MarketMood } {
  const advancing = Number(html.match(/Advancing<\/p>\s*<p>([0-9.]+)%/)?.[1]);
  const declining = Number(html.match(/Declining<\/p>\s*<p>\([^)]*\)\s*([0-9.]+)%/)?.[1]);
  const up = Number.isFinite(advancing) ? advancing : null;
  const down = Number.isFinite(declining) ? declining : null;
  let mood: MarketMood = "unknown";
  if (up != null) mood = up < 35 ? "risk-off" : up > 62 ? "risk-on" : "mixed";
  return { advancing: up, declining: down, mood };
}

export function breadthEffect(
  asset: string,
  direction: "BUY" | "SELL" | "WAIT",
  mood: MarketMood,
): { block: boolean; cut: boolean; why: string | null } {
  const none = { block: false, cut: false, why: null as string | null };
  if (direction === "WAIT" || mood === "unknown" || mood === "mixed") return none;
  if (mood === "risk-off" && asset === "BTCUSD" && direction === "BUY") {
    return { block: true, cut: true, why: "US stocks are falling — bitcoin buy paused" };
  }
  if (mood === "risk-off" && asset === "USDJPY" && direction === "BUY") {
    return { block: false, cut: true, why: "US stocks are falling — dollar-yen buy is less sure" };
  }
  if (mood === "risk-off" && asset === "XAUUSD" && direction === "SELL") {
    return { block: false, cut: true, why: "US stocks are falling — gold sell is less sure" };
  }
  if (mood === "risk-on" && asset === "BTCUSD" && direction === "SELL") {
    return { block: false, cut: true, why: "US stocks are rising — bitcoin sell is less sure" };
  }
  if (mood === "risk-on" && asset === "XAUUSD" && direction === "BUY") {
    return { block: false, cut: true, why: "US stocks are rising — gold buy is less sure" };
  }
  return none;
}

export function parseMessari(body: unknown): CoinScan[] {
  const data = (body as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: CoinScan[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const o = row as { symbol?: string; name?: string; rank?: number; sector?: string };
    if (!o.symbol || !o.name) continue;
    out.push({ symbol: o.symbol, name: o.name, rank: Number(o.rank) || 0, sector: o.sector || "—" });
    if (out.length >= 8) break;
  }
  return out;
}
