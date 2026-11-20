import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { deriveKey } from "./secret-box";

/**
 * Single-use recovery codes (S4), shaped like the mockup's `7KQM-2XPA` (A6).
 *
 * Crockford's alphabet: no I, L, O or U, so a handwritten code cannot be
 * misread. 32 symbols, so `byte & 31` picks each one without modulo bias.
 *
 * Stored as HMAC-SHA256 under a key derived from `TOTP_ENCRYPTION_KEY`, not
 * bcrypt. Checking a typed code against ten bcrypt hashes at cost 12 costs
 * seconds of CPU on the PC that also runs the database. The key keeps a copy
 * of the database alone from brute-forcing the 40-bit codes. Losing the key
 * loses the codes along with the TOTP secrets; S13 recovers from that.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_COUNT = 10;
const HALF = 4;

function randomCode(): string {
  const chars = [...randomBytes(HALF * 2)].map((byte) => ALPHABET[byte & 31]);
  return `${chars.slice(0, HALF).join("")}-${chars.slice(HALF).join("")}`;
}

export function generateRecoveryCodes(count = CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomCode());
  return [...codes];
}

/** Case, spaces and any dash are ignored; O reads as 0 and I or L as 1. */
function normalize(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function hashRecoveryCode(code: string, key: Buffer): string {
  return createHmac("sha256", deriveKey(key, "recovery-code")).update(normalize(code)).digest("hex");
}

/** The index of the stored hash `typed` matches, or null. */
export function matchRecoveryCode(typed: string, hashes: readonly string[], key: Buffer): number | null {
  if (normalize(typed).length !== HALF * 2) return null;
  const candidate = Buffer.from(hashRecoveryCode(typed, key), "hex");
  const index = hashes.findIndex((hash) => {
    const stored = Buffer.from(hash, "hex");
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  });
  return index === -1 ? null : index;
}
