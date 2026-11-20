import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226): SHA-1, six digits, 30-second steps,
 * which is what every authenticator app defaults to (S2). `node:crypto` only.
 */
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** One step either side: a phone clock up to about 30 seconds off still works. */
const DRIFT_STEPS = 1;
const SECRET_BYTES = 20;
/** RFC 4226 §4 minimum; below it, a blank or damaged stored secret would give guessable codes. */
const MIN_SECRET_BYTES = 16;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Forgives case, spaces and padding, as apps display secrets in groups. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

const stepAt = (now: Date) => Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);

export function totpAt(secret: string, now: Date): string {
  return hotp(base32Decode(secret), stepAt(now));
}

/**
 * The time step `code` belongs to, or null. A step at or before `lastStep`
 * (the last accepted one) is refused, so a code works once.
 */
export function verifyTotp(secret: string, code: string, now: Date, lastStep?: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  if (key.length < MIN_SECRET_BYTES) return null;
  const typed = Buffer.from(code);
  const current = stepAt(now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (lastStep !== undefined && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), typed)) return step;
  }
  return null;
}

/** What the enrolment QR encodes. The issuer is per install (the workshop name), never fixed here. */
export function otpauthUri(input: { secret: string; issuer: string; account: string }): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = `${issuer}:${encodeURIComponent(input.account)}`;
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}
