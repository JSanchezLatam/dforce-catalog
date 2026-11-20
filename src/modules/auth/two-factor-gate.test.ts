import { describe, expect, it } from "vitest";

import { isSecondFactorExempt, TWO_FACTOR_PATH } from "./two-factor-gate";

/**
 * A session at `pending = 'verify'` reaches only these three paths (L28): the
 * code screen, its POST target, and logout. Without any one of them the user
 * loops, cannot submit, or is trapped.
 */
describe("isSecondFactorExempt() — the three exemptions", () => {
  it.each([TWO_FACTOR_PATH, "/api/two-factor/verify", "/api/logout"])("exempts %s", (path) => {
    expect(isSecondFactorExempt(path)).toBe(true);
  });

  it("puts the code screen at /two-factor, outside /login*, which skips the proxy", () => {
    expect(TWO_FACTOR_PATH).toBe("/two-factor");
  });
});

describe("isSecondFactorExempt() — everything else stays blocked", () => {
  it.each([
    "/",
    "/inventory",
    "/account",
    "/change-password",
    "/api/account/password",
    "/api/customers",
    // Exact match, not prefix.
    "/two-factor/setup",
    "/two-factor-decoy",
    "/api/two-factor",
    "/api/two-factor/verify/extra",
  ])("does not exempt %s", (path) => {
    expect(isSecondFactorExempt(path)).toBe(false);
  });
});
