import type { Candle } from "./types.ts";

export interface MakerCard {
  name: string;
  model: string;
  book: "Unknown";
  growth: string;
}

export const MAKER_CARDS: MakerCard[] = [
  {
    name: "Citadel Securities",
    model: "Buys and sells to retail and funds, and keeps a small spread.",
    book: "Unknown",
    growth: "Their live positions are not published.",
  },
  {
    name: "Virtu",
    model: "Most trading income is the bid-ask spread across millions of small trades. Volatility widens that spread.",
    book: "Unknown",
    growth: "Their 2024 annual report says trading income moves with volume and spreads. The daily book is not public.",
  },
  {
    name: "GTS",
    model: "Electronic market maker in stocks and ETFs.",
    book: "Unknown",
    growth: "No public trading book.",
  },
  {
    name: "Flow Traders",
    model: "ETF market maker. Income follows how much ETF volume they intermediate.",
    book: "Unknown",
    growth: "Their 30 Jul 2026 release: H1 net trading income €304m, up 7% vs H1 2025. ETF value traded €1.28tn, up 34%.",
  },
  {
    name: "Jane Street",
    model: "ETF and bond market maker. Public filings of the book do not exist.",
    book: "Unknown",
    growth: "No public income series.",
  },
  {
    name: "Optiver",
    model: "Prices options and ETFs. The edge is the volatility spread, not a chart pattern.",
    book: "Unknown",
    growth: "No public position file.",
  },
  {
    name: "IMC",
    model: "Options and ETF market maker. Same spread-versus-toxic-flow trade.",
    book: "Unknown",
    growth: "No public position file.",
  },
  {
    name: "Two Sigma",
    model: "Systematic fund. Many small tested edges, not a quoted bid-ask desk.",
    book: "Unknown",
    growth: "No public portfolio.",
  },
  {
    name: "Jump",
    model: "Low-latency quoting. A fast sweep is toxic if the candle does not accept a side.",
    book: "Unknown",
    growth: "No public position file.",
  },
  {
    name: "Susquehanna",
    model: "Options specialist. Decisions are expected value, not a high win rate.",
    book: "Unknown",
    growth: "No public position file.",
  },
];

export function makerGate(opts: { spread: number; atr: number; closed: Candle[] }): string | null {
  const atr = opts.atr;
  if (!(atr > 0)) return null;
  if (opts.spread > 0.25 * atr) {
    return "Spread is wide versus a normal candle. Liquidity makers have stepped back. Do not pay it.";
  }
  const last = opts.closed.at(-1);
  if (!last) return null;
  const range = last.high - last.low;
  if (range <= 2.5 * atr) return null;
  const pos = (last.close - last.low) / Math.max(range, 1e-12);
  if (pos > 0.25 && pos < 0.75) {
    return "A wide candle closed in the middle. Makers treat that as toxic flow. Wait for the next close.";
  }
  return null;
}
