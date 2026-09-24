import type { DataSource } from "./types.ts";
import { showsLiveExness } from "./provenance.ts";

export type DataOrigin = "exness" | "public" | "demo" | "simulated" | "fixture" | "unverified" | "unknown";

/** Exness, public venues, demo, fixture, and simulated tapes stay distinct. */
export function dataOrigin(source: DataSource | string, demo = false): DataOrigin {
  if (source === "fixture") return "fixture";
  if (demo) return "demo";
  if (source === "unverified") return "unverified";
  if (source === "exness") return showsLiveExness(source, demo) ? "exness" : "unverified";
  if (source === "simulated" || source === "replay") return "simulated";
  if (source === "yahoo" || source === "kraken" || source === "coinbase" || source === "websocket") return "public";
  return "unknown";
}

export function originLabel(origin: DataOrigin, stale: boolean) {
  const name =
    origin === "exness"
      ? "Exness"
      : origin === "fixture"
        ? "Fixture · test"
        : origin === "unverified"
          ? "Unverified"
          : origin === "public"
            ? "Public market"
            : origin === "demo"
              ? "Demo"
              : origin === "simulated"
                ? "Simulated"
                : "Unknown source";
  return stale ? `${name} · stale` : name;
}

export function feedClaim(source: string, demo = false) {
  const origin = dataOrigin(source, demo);
  return { text: originLabel(origin, false), liveExness: showsLiveExness(source, demo) };
}
