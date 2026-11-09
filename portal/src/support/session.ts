import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "support_session";
export const SESSION_SECONDS = 12 * 60 * 60;
// Checked before any compare, so both signatures have the same length (as contract.ts verify).
const SHAPE = /^\d+\.[0-9a-f]{64}$/;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const mac = (secret: string, exp: string) => createHmac("sha256", secret).update(`support:${exp}`).digest("hex");
const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** `<expSeconds>.<hex HMAC>`: stateless, so rotating the secret revokes every session. */
export function signSession(secret: string, now: number = nowSeconds()): string {
  const exp = String(now + SESSION_SECONDS);
  return `${exp}.${mac(secret, exp)}`;
}

/** True only for an unexpired value signed with `secret`. An unset secret fails closed. */
export function verifySession(value: string | undefined, secret: string | undefined, now: number = nowSeconds()): boolean {
  if (!secret || !value || !SHAPE.test(value)) return false;
  const [exp, signature] = value.split(".");
  if (Number(exp) <= now) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(mac(secret, exp), "hex"));
}

/** Digests make both sides 32 bytes, so the compare leaks neither content nor length. */
export function passwordMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";
export const sessionCookie = (value: string) => `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_SECONDS}; ${ATTRIBUTES}`;
export const clearedCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;

/**
 * Every support page, action and API route calls this itself (guard.test.ts enforces it):
 * pages redirect to /support/login when false, APIs answer 401.
 */
export async function requireSupport(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, process.env.SUPPORT_SESSION_SECRET);
}
