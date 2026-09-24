import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Desktop storage is a local folder. A hosted DATABASE_URL is not used. */
/** @param {Record<string, string | undefined>} env */
export function prepareDesktopEnv(env) {
  const next = { ...env };
  delete next.DATABASE_URL;
  return next;
}

export function generateToken() {
  return `exn_${crypto.randomBytes(32).toString("hex")}`;
}

/** @param {string} dir */
function tokenFile(dir) {
  return path.join(dir, "pairing.token");
}

/** @param {string} dir */
export function readToken(dir) {
  try {
    return fs.readFileSync(tokenFile(dir), "utf8").trim();
  } catch {
    return "";
  }
}

/** @param {string} dir */
export function ensureToken(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const existing = readToken(dir);
  if (existing) return existing;
  const token = generateToken();
  fs.writeFileSync(tokenFile(dir), token, { encoding: "utf8", mode: 0o600 });
  return token;
}

/** @param {string} dir */
export function resetToken(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const token = generateToken();
  fs.writeFileSync(tokenFile(dir), token, { encoding: "utf8", mode: 0o600 });
  return token;
}

/** Fail closed. Origin is not a credential. An empty token never matches. */
/** @param {string} dir @param {string | null | undefined} presented */
export function verifyToken(dir, presented) {
  const need = readToken(dir);
  const got = String(presented ?? "").trim();
  if (!need || !got || need.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(need), Buffer.from(got));
}
