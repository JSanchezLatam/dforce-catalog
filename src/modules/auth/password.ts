import bcrypt from "bcrypt";

/**
 * R9.5 — bcrypt cost factor >= 12. bcrypt.hash() generates a fresh random
 * salt per call and embeds it in the returned hash, so "unique salt per
 * user per hash operation" is satisfied by the library itself — no manual
 * salt handling needed.
 */
const COST_FACTOR = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
