import { describe, expect, it, vi } from "vitest";

import { authenticateUser, type AuthenticateUserDeps } from "./authenticate";

const attempts = {
  reserve: vi.fn().mockResolvedValue({ attemptId: "attempt-1" }),
  settle: vi.fn().mockResolvedValue(undefined),
};

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
      attempts,
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
      attempts,
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
      attempts,
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
      attempts,
    };

    const result = await authenticateUser("active-admin", "correct-password", deps);

    expect(result).toEqual({ ok: true, token: "tok", expiresAt: expect.any(Date), role: "administrador" });
    expect(deps.issueSession).toHaveBeenCalledWith("user-3", "administrador");
  });
});

describe("authenticateUser() — login attempts and locks", () => {
  const activeUser = {
    id: "user-1",
    passwordHash: "stored-hash",
    role: "tecnico" as const,
    deactivatedAt: null,
  };

  function attemptDeps(overrides: Partial<AuthenticateUserDeps> = {}) {
    const reserve = vi.fn().mockResolvedValue({ attemptId: "attempt-1" });
    const settle = vi.fn().mockResolvedValue(undefined);
    return {
      reserve,
      settle,
      deps: {
        attempts: { reserve, settle },
        findUser: vi.fn().mockResolvedValue(activeUser),
        verifyPassword: vi.fn().mockResolvedValue(true),
        issueSession: vi.fn().mockResolvedValue({ token: "t", expiresAt: new Date(0) }),
        ...overrides,
      } satisfies AuthenticateUserDeps,
    };
  }

  it("reserves the attempt under the login as typed and the client IP before comparing", async () => {
    const { deps, reserve } = attemptDeps();

    await authenticateUser("Ana", "clave", { ...deps, ip: "192.168.1.23" });

    expect(reserve).toHaveBeenCalledWith({ username: "Ana", ip: "192.168.1.23" });
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.verifyPassword).mock.invocationCallOrder[0]);
  });

  it("refuses a locked login without comparing the password or issuing a session", async () => {
    const until = new Date("2026-11-18T12:15:00.000Z");
    const { deps, reserve, settle } = attemptDeps();
    reserve.mockResolvedValue({ lockedUntil: until });

    const result = await authenticateUser("ana", "correct", deps);

    expect(result).toEqual({ ok: false, lockedUntil: until });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    expect(deps.issueSession).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("records a successful login against the user", async () => {
    const { deps, settle } = attemptDeps();

    await authenticateUser("ana", "correct", deps);

    expect(settle).toHaveBeenCalledWith("attempt-1", "success", "user-1");
  });

  it("records a wrong password", async () => {
    const { deps, settle } = attemptDeps({ verifyPassword: vi.fn().mockResolvedValue(false) });

    expect(await authenticateUser("ana", "wrong", deps)).toEqual({ ok: false });
    expect(settle).toHaveBeenCalledWith("attempt-1", "bad_password", "user-1");
  });

  it("records a deactivated account", async () => {
    const { deps, settle } = attemptDeps({
      findUser: vi.fn().mockResolvedValue({ ...activeUser, deactivatedAt: new Date() }),
    });

    expect(await authenticateUser("ana", "correct", deps)).toEqual({ ok: false });
    expect(settle).toHaveBeenCalledWith("attempt-1", "inactive", "user-1");
  });

  it("still spends a password comparison on an unknown user, so timing does not reveal it", async () => {
    const { deps, settle } = attemptDeps({ findUser: vi.fn().mockResolvedValue(undefined) });

    expect(await authenticateUser("nadie", "clave", deps)).toEqual({ ok: false });
    expect(deps.verifyPassword).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith("attempt-1", "unknown_user", null);
  });
});
