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
        // Not a mandatory 2FA role: an administrador without 2FA now gets an enroll session (T8b).
        role: "tecnico" as const,
        deactivatedAt: null,
      }),
      verifyPassword: vi.fn().mockResolvedValue(true),
      issueSession: vi.fn().mockResolvedValue({ token: "tok", expiresAt: new Date() }),
      hasTwoFactor: vi.fn().mockResolvedValue(false),
      attempts,
    };

    const result = await authenticateUser("active-admin", "correct-password", deps);

    expect(result).toEqual({ ok: true, token: "tok", expiresAt: expect.any(Date), role: "tecnico" });
    expect(deps.issueSession).toHaveBeenCalledWith("user-3", "tecnico");
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
        hasTwoFactor: vi.fn().mockResolvedValue(false),
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

  describe("a user with 2FA enabled (T6, L28)", () => {
    const pendingExpiry = new Date("2026-11-20T12:10:00.000Z");
    const twoFactorDeps = () =>
      attemptDeps({
        hasTwoFactor: vi.fn().mockResolvedValue(true),
        issueSession: vi.fn().mockResolvedValue({ token: "pending-token", expiresAt: pendingExpiry }),
      });

    it("issues a pending verify session, not a full one", async () => {
      const { deps } = twoFactorDeps();

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.hasTwoFactor).toHaveBeenCalledWith("user-1");
      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "tecnico", { pending: "verify" });
      expect(result).toEqual({ ok: true, token: "pending-token", expiresAt: pendingExpiry, role: "tecnico", pending: "verify" });
    });

    // A success resets the lock counter; the password alone must not.
    it("settles the attempt as password_ok, not success", async () => {
      const { deps, settle } = twoFactorDeps();

      await authenticateUser("ana", "correct", deps);

      expect(settle).toHaveBeenCalledWith("attempt-1", "password_ok", "user-1");
      expect(settle).not.toHaveBeenCalledWith("attempt-1", "success", expect.anything());
    });

    it("still records a wrong password and issues nothing", async () => {
      const { deps, settle } = attemptDeps({
        hasTwoFactor: vi.fn().mockResolvedValue(true),
        verifyPassword: vi.fn().mockResolvedValue(false),
      });

      expect(await authenticateUser("ana", "wrong", deps)).toEqual({ ok: false });
      expect(settle).toHaveBeenCalledWith("attempt-1", "bad_password", "user-1");
      expect(deps.issueSession).not.toHaveBeenCalled();
    });

    it("leaves a user without 2FA on a full session and success", async () => {
      const { deps, settle } = attemptDeps();

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "tecnico");
      expect(settle).toHaveBeenCalledWith("attempt-1", "success", "user-1");
      expect(result).toEqual({ ok: true, token: "t", expiresAt: new Date(0), role: "tecnico" });
    });
  });

  describe("a trusted device cookie (T9, L45)", () => {
    const trustedDeps = (overrides: Partial<AuthenticateUserDeps> = {}) =>
      attemptDeps({
        hasTwoFactor: vi.fn().mockResolvedValue(true),
        trustedDeviceToken: "device-token",
        isTrustedDevice: vi.fn().mockResolvedValue(true),
        ...overrides,
      });

    it("skips the code with a full session, settled as a success through the trusted device", async () => {
      const { deps, settle } = trustedDeps();

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.isTrustedDevice).toHaveBeenCalledWith("user-1", "device-token");
      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "tecnico");
      expect(settle).toHaveBeenCalledWith("attempt-1", "success", "user-1", "trusted_device");
      expect(result).toEqual({ ok: true, token: "t", expiresAt: new Date(0), role: "tecnico" });
    });

    it("asks for the code when the cookie matches no device of this user", async () => {
      const { deps, settle } = trustedDeps({ isTrustedDevice: vi.fn().mockResolvedValue(false) });

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "tecnico", { pending: "verify" });
      expect(settle).toHaveBeenCalledWith("attempt-1", "password_ok", "user-1");
      expect(result).toMatchObject({ pending: "verify" });
    });

    it("never looks at the cookie on a wrong password, which still counts", async () => {
      const { deps, settle } = trustedDeps({ verifyPassword: vi.fn().mockResolvedValue(false) });

      expect(await authenticateUser("ana", "wrong", deps)).toEqual({ ok: false });
      expect(settle).toHaveBeenCalledWith("attempt-1", "bad_password", "user-1");
      expect(deps.isTrustedDevice).not.toHaveBeenCalled();
      expect(deps.issueSession).not.toHaveBeenCalled();
    });

    it("leaves a mandatory role without 2FA on enroll, whatever the cookie", async () => {
      const { deps } = trustedDeps({
        findUser: vi.fn().mockResolvedValue({ ...activeUser, role: "administrador" }),
        hasTwoFactor: vi.fn().mockResolvedValue(false),
      });

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "administrador", { pending: "enroll" });
      expect(result).toMatchObject({ pending: "enroll" });
    });
  });

  describe("a mandatory 2FA role without 2FA (T8b, L41)", () => {
    const enrollExpiry = new Date("2026-11-20T12:30:00.000Z");
    const mandatoryDeps = (role: "administrador" | "jefe_taller", hasTwoFactor = false) =>
      attemptDeps({
        findUser: vi.fn().mockResolvedValue({ ...activeUser, role }),
        hasTwoFactor: vi.fn().mockResolvedValue(hasTwoFactor),
        issueSession: vi.fn().mockResolvedValue({ token: "enroll-token", expiresAt: enrollExpiry }),
      });

    it.each(["administrador", "jefe_taller"] as const)("gives %s an enroll session, not a full one", async (role) => {
      const { deps } = mandatoryDeps(role);

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", role, { pending: "enroll" });
      expect(result).toEqual({ ok: true, token: "enroll-token", expiresAt: enrollExpiry, role, pending: "enroll" });
    });

    // No second factor exists yet, so the password is the whole login: it resets the counter.
    it("settles the attempt as success", async () => {
      const { deps, settle } = mandatoryDeps("administrador");

      await authenticateUser("ana", "correct", deps);

      expect(settle).toHaveBeenCalledWith("attempt-1", "success", "user-1");
    });

    it("still sends a mandatory role that has 2FA to the code step", async () => {
      const { deps } = mandatoryDeps("jefe_taller", true);

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", "jefe_taller", { pending: "verify" });
      expect(result).toMatchObject({ pending: "verify" });
    });

    it.each(["tecnico", "pantalla"] as const)("leaves %s without 2FA on a full session", async (role) => {
      const { deps } = attemptDeps({ findUser: vi.fn().mockResolvedValue({ ...activeUser, role }) });

      const result = await authenticateUser("ana", "correct", deps);

      expect(deps.issueSession).toHaveBeenCalledWith("user-1", role);
      expect(result).not.toHaveProperty("pending");
    });
  });
});
