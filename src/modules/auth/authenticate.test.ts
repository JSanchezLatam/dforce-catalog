import { describe, expect, it, vi } from "vitest";

import { authenticateUser } from "./authenticate";

/**
 * design.md Decision 7 — `authenticateUser()` must refuse a deactivated
 * user's credentials with the SAME generic failure as a bad password
 * (existing no-user-enumeration rule, R9.2). Without this half, revoking
 * sessions is theatre: the user simply logs in again.
 */
describe("authenticateUser() — deactivation refusal (design.md Decision 7)", () => {
  it("refuses a deactivated user even with correct credentials, generic failure (no enumeration)", async () => {
    const deps = {
      findUser: vi.fn().mockResolvedValue({
        id: "user-1",
        passwordHash: "irrelevant-hash",
        role: "tecnico" as const,
        deactivatedAt: new Date(),
      }),
      verifyPassword: vi.fn().mockResolvedValue(true),
      issueSession: vi.fn(),
    };

    const result = await authenticateUser("deactivated-user", "correct-password", deps);

    expect(result).toEqual({ ok: false });
    expect(deps.issueSession).not.toHaveBeenCalled();
    // verifyPassword may or may not have run — the point being asserted is
    // that no session gets issued for a deactivated account, not the order.
  });

  it("does not distinguish a deactivated user's failure from a wrong-password failure (shape parity)", async () => {
    const deactivatedDeps = {
      findUser: vi.fn().mockResolvedValue({
        id: "user-1",
        passwordHash: "hash",
        role: "tecnico" as const,
        deactivatedAt: new Date(),
      }),
      verifyPassword: vi.fn().mockResolvedValue(true),
      issueSession: vi.fn(),
    };
    const wrongPasswordDeps = {
      findUser: vi.fn().mockResolvedValue({
        id: "user-2",
        passwordHash: "hash",
        role: "tecnico" as const,
        deactivatedAt: null,
      }),
      verifyPassword: vi.fn().mockResolvedValue(false),
      issueSession: vi.fn(),
    };

    const deactivatedResult = await authenticateUser("deactivated-user", "correct-password", deactivatedDeps);
    const wrongPasswordResult = await authenticateUser("active-user", "wrong-password", wrongPasswordDeps);

    expect(deactivatedResult).toEqual(wrongPasswordResult);
    expect(deactivatedResult).toEqual({ ok: false });
  });

  it("still authenticates an active user unaffected by the new check", async () => {
    const deps = {
      findUser: vi.fn().mockResolvedValue({
        id: "user-3",
        passwordHash: "hash",
        role: "administrador" as const,
        deactivatedAt: null,
      }),
      verifyPassword: vi.fn().mockResolvedValue(true),
      issueSession: vi.fn().mockResolvedValue({ token: "tok", expiresAt: new Date() }),
    };

    const result = await authenticateUser("active-admin", "correct-password", deps);

    expect(result).toEqual({ ok: true, token: "tok", expiresAt: expect.any(Date), role: "administrador" });
    expect(deps.issueSession).toHaveBeenCalledWith("user-3");
  });
});
