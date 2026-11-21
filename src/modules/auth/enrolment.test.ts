import { describe, expect, it, vi } from "vitest";

import {
  confirmEnrolment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  requiresTwoFactor,
  startEnrolment,
} from "./enrolment";

// Everything past the shape, role and key checks is SQL: `src/e2e/two-factor-enrolment.e2e.test.ts`.
const brokenKey = () => {
  throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
};

describe("requiresTwoFactor (S2)", () => {
  it.each([
    ["administrador", true],
    ["jefe_taller", true],
    ["tecnico", false],
    ["pantalla", false],
  ] as const)("%s → %s", (role, expected) => {
    expect(requiresTwoFactor(role)).toBe(expected);
  });
});

describe("enrolment input that is not six digits", () => {
  it.each(["", "12345", "1234567", "12345a", " 123456", "123 456"])(
    "refuses %j before reading the key or opening a transaction",
    async (code) => {
      const key = vi.fn(brokenKey);
      const transaction = vi.fn();

      expect(await confirmEnrolment("u1", code, { key, transaction })).toEqual({ ok: false, reason: "invalid_code" });
      expect(await regenerateRecoveryCodes("u1", code, { key, transaction })).toEqual({ ok: false, reason: "invalid_code" });
      expect(await disableTwoFactor("u1", "tecnico", code, "t", { key, transaction })).toEqual({
        ok: false,
        reason: "invalid_code",
      });
      expect(key).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

describe("disableTwoFactor for a mandatory role (S2)", () => {
  it.each(["administrador", "jefe_taller"] as const)(
    "refuses %s even with a well-formed code, before any key or database work",
    async (role) => {
      const key = vi.fn(brokenKey);
      const transaction = vi.fn();
      const revoke = vi.fn();

      const result = await disableTwoFactor("u1", role, "123456", "t", { key, transaction, revokeOtherSessions: revoke });

      expect(result).toEqual({ ok: false, reason: "required_for_role" });
      expect(key).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    },
  );
});

describe("enrolment without a usable key", () => {
  it.each([
    ["startEnrolment", (deps: object) => startEnrolment("u1", "Taller", deps)],
    ["confirmEnrolment", (deps: object) => confirmEnrolment("u1", "123456", deps)],
    ["regenerateRecoveryCodes", (deps: object) => regenerateRecoveryCodes("u1", "123456", deps)],
    ["disableTwoFactor", (deps: object) => disableTwoFactor("u1", "tecnico", "123456", "t", deps)],
  ])("%s answers unavailable and opens no transaction, so it writes nothing", async (_name, run) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const transaction = vi.fn();
    const revoke = vi.fn();

    expect(await run({ key: brokenKey, transaction, revokeOtherSessions: revoke })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    // The reason, never the key.
    expect(error).toHaveBeenCalledWith("2FA unavailable:", "TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
    error.mockRestore();
  });
});
