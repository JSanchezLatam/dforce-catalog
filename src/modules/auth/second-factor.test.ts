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
});
