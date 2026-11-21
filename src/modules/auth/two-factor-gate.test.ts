import { describe, expect, it } from "vitest";

import { isEnrolmentExempt, isSecondFactorExempt, TWO_FACTOR_PATH, TWO_FACTOR_SETUP_PATH } from "./two-factor-gate";

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

/**
 * A session at `pending = 'enroll'` (T8b, L41) reaches only the setup screen,
 * its two POST targets, and logout. Exact match, as above.
 */
describe("isEnrolmentExempt() — the four exemptions", () => {
  it.each([TWO_FACTOR_SETUP_PATH, "/api/two-factor/setup/start", "/api/two-factor/setup/confirm", "/api/logout"])(
    "exempts %s",
    (path) => {
      expect(isEnrolmentExempt(path)).toBe(true);
    },
  );

  it("puts the setup screen at /two-factor/setup, outside /login*", () => {
    expect(TWO_FACTOR_SETUP_PATH).toBe("/two-factor/setup");
  });

  it.each([
    "/",
    "/inventory",
    "/account",
    TWO_FACTOR_PATH,
    "/api/two-factor/verify",
    "/change-password",
    "/api/account/password",
    "/api/account/two-factor/start",
    "/two-factor/setup/",
    "/two-factor/setup-decoy",
    "/api/two-factor/setup",
    "/api/two-factor/setup/start/extra",
  ])("does not exempt %s", (path) => {
    expect(isEnrolmentExempt(path)).toBe(false);
  });
});
