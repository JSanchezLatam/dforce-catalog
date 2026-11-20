import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openSecret, parseTotpKey, sealSecret } from "./secret-box";

const key = randomBytes(32);
const otherKey = randomBytes(32);

/** Flips one byte of the given part of a sealed value (`v1:iv:tag:ciphertext`). */
function tamper(sealed: string, part: 1 | 2 | 3): string {
  const parts = sealed.split(":");
  const bytes = Buffer.from(parts[part], "base64url");
  bytes[0] ^= 0x01;
  parts[part] = bytes.toString("base64url");
  return parts.join(":");
}

describe("sealSecret / openSecret", () => {
  it("opens what it sealed, for the same user", () => {
    const sealed = sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key);

    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("GEZDGNBVGY3TQOJQ");
    expect(openSecret(sealed, "user-1", key)).toBe("GEZDGNBVGY3TQOJQ");
  });

  it("uses a fresh IV, so the same secret never seals the same way twice", () => {
    expect(sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key)).not.toBe(sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key));
  });

  it("refuses another user's row, so secrets cannot be swapped between users", () => {
    expect(() => openSecret(sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key), "user-2", key)).toThrow();
  });

  it("refuses the wrong key", () => {
    expect(() => openSecret(sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key), "user-1", otherKey)).toThrow();
  });

  it.each([
    { part: 1, name: "IV" },
    { part: 2, name: "tag" },
    { part: 3, name: "ciphertext" },
  ] as const)("refuses a tampered $name", ({ part }) => {
    expect(() => openSecret(tamper(sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key), part), "user-1", key)).toThrow();
  });

  it("refuses a truncated tag, which GCM would otherwise accept down to 4 bytes", () => {
    const parts = sealSecret("GEZDGNBVGY3TQOJQ", "user-1", key).split(":");
    parts[2] = Buffer.from(parts[2], "base64url").subarray(0, 4).toString("base64url");

    expect(() => openSecret(parts.join(":"), "user-1", key)).toThrow();
  });

  it("refuses extra fields", () => {
    expect(() => openSecret(`${sealSecret("x", "user-1", key)}:extra`, "user-1", key)).toThrow();
  });

  it("refuses an unknown format version", () => {
    expect(() => openSecret(sealSecret("x", "user-1", key).replace(/^v1:/, "v9:"), "user-1", key)).toThrow();
  });
});

describe("parseTotpKey", () => {
  it("reads a base64 key of exactly 32 bytes", () => {
    expect(parseTotpKey(key.toString("base64"))).toEqual(key);
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
    ["31 bytes", randomBytes(31).toString("base64")],
    ["33 bytes", randomBytes(33).toString("base64")],
  ])("refuses a key that is %s", (_label, raw) => {
    expect(() => parseTotpKey(raw)).toThrow(/TOTP_ENCRYPTION_KEY/);
  });
});

describe("totpKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("checks TOTP_ENCRYPTION_KEY when 2FA asks for it, so a missing key does not stop the boot", async () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "");
    vi.resetModules();
    const box = await import("./secret-box");
    expect(() => box.totpKey()).toThrow(/TOTP_ENCRYPTION_KEY/);

    vi.stubEnv("TOTP_ENCRYPTION_KEY", key.toString("base64"));
    vi.resetModules();
    expect((await import("./secret-box")).totpKey()).toEqual(key);
  });

  it("is a sensitive key, never logged", async () => {
    const { SENSITIVE_ENV_KEYS } = await import("@/shared/config/env");
    expect(SENSITIVE_ENV_KEYS).toContain("TOTP_ENCRYPTION_KEY");
  });
});
