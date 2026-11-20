import { describe, expect, it, vi } from "vitest";

import { verifySecondFactor } from "./second-factor";

// Everything past the key is SQL, covered by `src/e2e/two-factor-verify.e2e.test.ts`.
describe("verifySecondFactor without a usable key", () => {
  it.each([
    ["code", { code: "123456" }],
    ["recovery code", { recoveryCode: "AAAA-BBBB" }],
  ])("answers unavailable for a %s and opens no transaction, so it writes nothing", async (_label, input) => {
    const transaction = vi.fn();
    const key = () => {
      throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
    };

    const result = await verifySecondFactor({ token: "t", ip: "10.0.0.1", ...input }, { key, transaction });

    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(transaction).not.toHaveBeenCalled();
  });

  // The operator asked to fix it needs to tell a missing key from a wrong one; the key itself is never logged.
  it("logs why the key is unusable, without the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "c2VjcmV0");
    const key = () => {
      throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
    };

    await verifySecondFactor({ token: "t", ip: null, code: "123456" }, { key, transaction: vi.fn() });

    expect(error).toHaveBeenCalledWith("2FA unavailable:", "TOTP_ENCRYPTION_KEY must be 32 bytes in base64");
    expect(JSON.stringify(error.mock.calls)).not.toContain("c2VjcmV0");
    error.mockRestore();
    vi.unstubAllEnvs();
  });
});
