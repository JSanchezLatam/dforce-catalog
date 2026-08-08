import { describe, expect, it } from "vitest";

import { CHANGE_PASSWORD_PATH, isPasswordChangeExempt } from "./forced-change";

/**
 * Each of the three exemptions is load-bearing (design.md Decision 8): without
 * the screen itself the redirect target redirects (infinite loop); without the
 * POST target the screen renders but can never submit; without logout a user
 * unwilling to rotate is trapped with no way out.
 */
describe("isPasswordChangeExempt() — the three load-bearing exemptions", () => {
  it("exempts the forced-change screen itself, so the redirect target cannot redirect to itself", () => {
    expect(isPasswordChangeExempt(CHANGE_PASSWORD_PATH)).toBe(true);
  });

  it("exempts the password-change POST target, so the screen can actually submit", () => {
    expect(isPasswordChangeExempt("/api/account/password")).toBe(true);
  });

  it("exempts logout, so the user always has an exit", () => {
    expect(isPasswordChangeExempt("/api/logout")).toBe(true);
  });
});

describe("isPasswordChangeExempt() — everything else stays blocked", () => {
  it.each(["/", "/inventory", "/account", "/users", "/api/customers", "/api/users"])(
    "does not exempt %s",
    (path) => {
      expect(isPasswordChangeExempt(path)).toBe(false);
    },
  );

  // Exact match, not prefix: `/api/account` (the profile GET/PATCH route) shares
  // a prefix with `/api/account/password`, and a decoy path shares one with the
  // change-password page. Prefix matching here would silently widen the hole a
  // flagged user can drive through.
  it("does not exempt /api/account, which merely prefixes the exempt password route", () => {
    expect(isPasswordChangeExempt("/api/account")).toBe(false);
  });

  it("does not exempt a decoy path that merely prefixes the change-password page", () => {
    expect(isPasswordChangeExempt(`${CHANGE_PASSWORD_PATH}-decoy`)).toBe(false);
  });

  it("does not exempt a nested path under the change-password page", () => {
    expect(isPasswordChangeExempt(`${CHANGE_PASSWORD_PATH}/nested`)).toBe(false);
  });
});
