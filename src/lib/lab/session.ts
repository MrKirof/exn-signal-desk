import type { AssetId, SessionInfo, SessionName } from "./types.ts";

export function emptySession(): SessionInfo {
  return { name: "OFF", label: "Off-session", hourUtc: 0, active: false };
}

export function fxSession(now = Date.now(), asset: AssetId = "EURUSD"): SessionInfo {
  const hourUtc = new Date(now).getUTCHours();
  let name: SessionName = "OFF";
  let label = "Off-session";
  if (hourUtc >= 12 && hourUtc < 16) {
    name = "OVERLAP";
    label = "London / New York overlap";
  } else if (hourUtc >= 7 && hourUtc < 16) {
    name = "LONDON";
    label = "London";
  } else if (hourUtc >= 12 && hourUtc < 21) {
    name = "NEW_YORK";
    label = "New York";
  } else if (hourUtc >= 0 && hourUtc < 8) {
    name = "ASIA";
    label = "Asia";
  }
  const crypto = asset === "BTCUSD";
  const active = crypto || name === "LONDON" || name === "NEW_YORK" || name === "OVERLAP";
  return { name, label, hourUtc, active };
}
