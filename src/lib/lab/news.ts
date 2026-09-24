import type { AssetId, NewsEvent, NewsImpact } from "./types.ts";
import { assetMeta } from "./constants.ts";
import { uid } from "./rng.ts";

const TITLES: { currency: string; title: string; impact: NewsImpact }[] = [
  { currency: "USD", title: "FOMC statement", impact: "high" },
  { currency: "USD", title: "Non-farm payrolls", impact: "high" },
  { currency: "USD", title: "CPI YoY", impact: "high" },
  { currency: "USD", title: "Unemployment claims", impact: "medium" },
  { currency: "EUR", title: "ECB rate decision", impact: "high" },
  { currency: "EUR", title: "German CPI", impact: "medium" },
  { currency: "GBP", title: "BoE rate decision", impact: "high" },
  { currency: "GBP", title: "UK GDP", impact: "medium" },
  { currency: "JPY", title: "BoJ policy", impact: "high" },
  { currency: "USD", title: "ISM manufacturing", impact: "medium" },
];

export function seedNews(now = Date.now()): NewsEvent[] {
  // Demo calendar only. High-impact prints sit hours away so they do not
  // permanently blackout every USD pair (old layout put FOMC at t=now).
  const hours = [-18, -12, -8, -5, -3, 4, 7, 11, 16, 22];
  return TITLES.map((t, i) => ({
    id: uid("news"),
    t: now + hours[i]! * 60 * 60 * 1000,
    currency: t.currency,
    title: t.title,
    impact: t.impact,
    actual: hours[i]! < 0 ? "released" : null,
  }));
}

export function minutesToNews(events: NewsEvent[], asset: AssetId, now = Date.now()) {
  const curs = assetMeta(asset).currencies;
  let best = Infinity;
  for (const e of events) {
    if (e.impact !== "high") continue;
    if (!curs.includes(e.currency)) continue;
    const m = (e.t - now) / 60000;
    if (Math.abs(m) < Math.abs(best)) best = m;
  }
  return Number.isFinite(best) ? best : 999;
}

export function newsBlock(events: NewsEvent[], asset: AssetId, now = Date.now()) {
  const m = minutesToNews(events, asset, now);
  if (m >= 0 && m <= 18) return `High-impact news in ${Math.round(m)} minutes`;
  if (m < 0 && m >= -12) return `Post-event cooldown (${Math.round(-m)}m)`;
  return null;
}

export function newsFreshness(events: NewsEvent[], now = Date.now()) {
  if (!events.length) return 0;
  const newest = Math.max(...events.map((e) => e.t));
  return newest;
}

const SHOCK = /fomc|cpi|nfp|non-farm|payroll|rate decision|interest rate|\bfed\b|ecb|boj|boe|inflation|gdp|tariff|sanction|jobs report|central bank/i;

const NAME: Record<string, string[]> = {
  USD: ["USD", "US ", "U.S", "FED", "FOMC", "NFP", "DOLLAR"],
  EUR: ["EUR", "EURO", "ECB"],
  GBP: ["GBP", "UK ", "BOE", "STERLING", "POUND"],
  JPY: ["JPY", "YEN", "BOJ"],
  XAU: ["XAU", "GOLD"],
  BTC: ["BTC", "BITCOIN"],
};

export interface WireHit {
  title: string;
  url?: string;
  at?: number;
}

function mentionsPair(title: string, asset: AssetId) {
  const up = title.toUpperCase();
  return assetMeta(asset).currencies.some((c) => (NAME[c] ?? [c]).some((n) => up.includes(n)));
}

export function readWire(headlines: WireHit[], asset: AssetId, now = Date.now()) {
  let block: string | null = null;
  let caution: string | null = null;
  for (const h of headlines) {
    if (!SHOCK.test(h.title)) continue;
    const named = mentionsPair(h.title, asset);
    if (!named) continue;
    const ageMin = h.at ? (now - h.at) / 60000 : 180;
    if (ageMin >= -5 && ageMin <= 90) {
      block = `Web shock · ${h.title.slice(0, 90)}`;
      break;
    }
    if (!caution && ageMin <= 12 * 60) caution = `Web caution · ${h.title.slice(0, 90)}`;
  }
  if (block) return { level: "block" as const, why: block, line: block };
  if (caution) return { level: "caution" as const, why: caution, line: caution };
  if (!headlines.length) return { level: "clear" as const, why: null, line: "Web feed empty — price logic only" };
  return { level: "clear" as const, why: null, line: "Web checked · no rate or inflation shock" };
}
