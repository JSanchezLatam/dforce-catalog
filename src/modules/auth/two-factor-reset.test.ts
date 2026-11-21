import { describe, expect, it, vi } from "vitest";

import { resetTwoFactor } from "./two-factor-reset";

// The deletes, the session revoke and the single transaction are SQL: `src/e2e/two-factor-reset.e2e.test.ts`.
describe("resetTwoFactor (S5)", () => {
  it("refuses the caller's own id with self_reset before opening a transaction", async () => {
    const transaction = vi.fn();

    expect(await resetTwoFactor("admin-1", "admin-1", { transaction })).toEqual({ ok: false, reason: "self_reset" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
