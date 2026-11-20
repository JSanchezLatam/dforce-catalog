import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { env } from "@/shared/config/env";

/**
 * Encrypts each user's TOTP secret with AES-256-GCM under `TOTP_ENCRYPTION_KEY`
 * (S2). The key lives only in `.env`: a database copy without it reveals no
 * secret, and a restore without it leaves every secret unreadable.
 */
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function parseTotpKey(raw: string | undefined): Buffer {
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
  }
  return key;
}

/** Read when 2FA needs it, so a missing key fails that request, not the boot. */
export const totpKey = (): Buffer => parseTotpKey(env.TOTP_ENCRYPTION_KEY);

/** Separate keys per use, derived from the one in `.env`. */
export function deriveKey(key: Buffer, purpose: "totp-secret" | "recovery-code"): Buffer {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), `dforce ${purpose}`, KEY_BYTES));
}

/** The user id is authenticated data: one user's sealed secret does not open as another's. */
export function sealSecret(plain: string, userId: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(key, "totp-secret"), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(":");
}

/** Throws on a wrong key, a wrong user or any tampering. */
export function openSecret(sealed: string, userId: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unknown sealed secret format");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(key, "totp-secret"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
