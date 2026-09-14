import { describe, expect, it, vi } from "vitest";

import {
  changePassword,
  createUser,
  updateUser,
  DuplicateUsernameError,
  UserNotFoundError,
  SamePasswordError,
  updateProfile,
  ProfileValidationError,
  DuplicateEmailError,
  checkAdminSafety,
  deactivateUser,
  reactivateUser,
  AdminSafetyError,
  MIN_PASSWORD_LENGTH,
} from "./service";

/**
 * Asserts BOTH that the call was rejected as a `ProfileValidationError` and the
 * exact Spanish an operator reads — the routes forward `err.errors` verbatim as
 * the 400 body, so these literals are the copy rendered under the field.
 *
 * AGENTS.md: "Tests assert the Spanish string. Those are what catch an
 * untranslated screen." A bare `rejects.toThrow(ProfileValidationError)` knows
 * only that something was rejected, so an English message ships green under it.
 * The literals stay spelled out per-test rather than imported, for the reason
 * `shared/ui/messages.ts` gives: an assertion that imports what the code
 * imports moves with it and catches nothing.
 *
 * The promise is awaited twice on purpose — a settled promise can be asserted
 * on repeatedly, and this keeps the instance check without a second call.
 */
async function expectProfileErrors(promise: Promise<unknown>, errors: Record<string, string>): Promise<void> {
  await expect(promise).rejects.toThrow(ProfileValidationError);
  await expect(promise).rejects.toMatchObject({ errors });
}

/**
 * Fake `db.transaction` matching drizzle's shape (same style as
 * pdf-generation/enqueue.test.ts / catalog-storage/retention.test.ts). Tracks
 * the exact `tx` object reference handed to the callback so tests can assert
 * the count-read and the write both ran inside the SAME transaction — this
 * is a structural pin, not a live-concurrency test: a genuine two-admin race
 * needs a real Postgres instance and is not exercised here (same
 * documented gap as enqueue.test.ts's advisory-lock ordering assertion).
 */
function fakeTransactionalDatabase() {
  const tx = { marker: "tx" as const, execute: vi.fn() };
  let transactionCalls = 0;
  const database = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
      transactionCalls += 1;
      return fn(tx);
    },
  };
  return { database, tx, transactionCalls: () => transactionCalls };
}

describe("updateProfile", () => {
  it("persists name and email", async () => {
    const fn = vi.fn();
    await updateProfile("user-1", { name: "Juan", email: "juan@taller.com" }, fn, {
      getCurrentEmail: async () => null,
      findByEmail: async () => null,
    });
    expect(fn).toHaveBeenCalledWith("user-1", { name: "Juan", email: "juan@taller.com" });
  });

  it("clears name and email when null", async () => {
    const fn = vi.fn();
    await updateProfile("user-1", { name: null, email: null }, fn, {
      getCurrentEmail: async () => null,
      findByEmail: async () => null,
    });
    expect(fn).toHaveBeenCalledWith("user-1", { name: null, email: null });
  });

  it("rejects an invalid email format in Spanish and does NOT persist", async () => {
    const fn = vi.fn();
    await expectProfileErrors(
      updateProfile("user-1", { name: "Juan", email: "not-an-email" }, fn, {
        getCurrentEmail: async () => null,
        findByEmail: async () => null,
      }),
      { email: "El email no es válido." },
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email belonging to another user and does NOT persist", async () => {
    const fn = vi.fn();
    const findByEmail = vi.fn().mockResolvedValue({ id: "other-user" });
    await expect(
      updateProfile("user-1", { name: "Juan", email: "a@b.com" }, fn, {
        getCurrentEmail: async () => "old@taller.com",
        findByEmail,
      }),
    ).rejects.toThrow(DuplicateEmailError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does NOT flag the user's own unchanged email as a duplicate", async () => {
    const fn = vi.fn();
    const findByEmail = vi.fn();
    await updateProfile("user-1", { name: "Juan", email: "a@b.com" }, fn, {
      getCurrentEmail: async () => "a@b.com",
      findByEmail,
    });
    expect(findByEmail).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledWith("user-1", { name: "Juan", email: "a@b.com" });
  });
});

describe("changePassword", () => {
  it("rejects wrong current password and does NOT call updatePassword", async () => {
    const updatePassword = vi.fn();
    await expect(
      changePassword("user-1", "wrong", "new-pass", "token-1", {
        getCredentials: async () => ({ passwordHash: "$2b$12$hash_of_correct_password", mustChangePassword: false }),
        updatePassword,
        revoke: vi.fn(),
      }),
    ).rejects.toThrow("Invalid current password");
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("updates the password and revokes other sessions on correct password", async () => {
    const updatePassword = vi.fn();
    const revoke = vi.fn();
    const { hashPassword } = await import("@/modules/auth/password");
    const realHash = await hashPassword("correct-pass");

    await changePassword("user-1", "correct-pass", "new-pass", "token-1", {
      getCredentials: async () => ({ passwordHash: realHash, mustChangePassword: false }),
      updatePassword,
      revoke,
    });

    expect(updatePassword).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("user-1", "token-1");
  });

  /**
   * Spec `user-account` — "New Password Must Differ From the Temporary One".
   * The requirement is derived from the flag the same query already reads, NOT
   * from a caller-supplied argument: `parseSessionUser()` deliberately does not
   * forward `mustChangePassword` to route handlers (session.ts), so a caller
   * has no way to pass it, and a rule that can be silently omitted by a caller
   * is not a rule.
   */
  describe("forced rotation — new password must differ from the temporary one", () => {
    it("rejects an unchanged password for a flagged user and writes nothing", async () => {
      const updatePassword = vi.fn();
      const revoke = vi.fn();
      const { hashPassword } = await import("@/modules/auth/password");
      const realHash = await hashPassword("temp-pass");

      await expect(
        changePassword("user-1", "temp-pass", "temp-pass", "token-1", {
          getCredentials: async () => ({ passwordHash: realHash, mustChangePassword: true }),
          updatePassword,
          revoke,
        }),
      ).rejects.toThrow(SamePasswordError);

      // The flag must survive a rejected attempt — otherwise a user clears the
      // forced rotation by submitting the temporary password back at it.
      expect(updatePassword).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    });

    it("still rejects a wrong current password before the same-password check runs", async () => {
      const updatePassword = vi.fn();
      const { hashPassword } = await import("@/modules/auth/password");
      const realHash = await hashPassword("temp-pass");

      await expect(
        changePassword("user-1", "wrong", "wrong", "token-1", {
          getCredentials: async () => ({ passwordHash: realHash, mustChangePassword: true }),
          updatePassword,
          revoke: vi.fn(),
        }),
      ).rejects.toThrow("Invalid current password");
      expect(updatePassword).not.toHaveBeenCalled();
    });

    it("accepts a genuinely different password for a flagged user", async () => {
      const updatePassword = vi.fn();
      const revoke = vi.fn();
      const { hashPassword } = await import("@/modules/auth/password");
      const realHash = await hashPassword("temp-pass");

      await changePassword("user-1", "temp-pass", "a-real-password", "token-1", {
        getCredentials: async () => ({ passwordHash: realHash, mustChangePassword: true }),
        updatePassword,
        revoke,
      });

      // One write, not two: the hash and the cleared flag land in the SAME
      // UPDATE, so a flagged user can never end up with a rotated password and
      // a still-set flag (which would lock them out of the app they just
      // unlocked).
      expect(updatePassword).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith("user-1", "token-1");
    });

    it("leaves self-service untouched — an unflagged user may reuse their current password", async () => {
      const updatePassword = vi.fn();
      const { hashPassword } = await import("@/modules/auth/password");
      const realHash = await hashPassword("same-pass");

      await changePassword("user-1", "same-pass", "same-pass", "token-1", {
        getCredentials: async () => ({ passwordHash: realHash, mustChangePassword: false }),
        updatePassword,
        revoke: vi.fn(),
      });

      expect(updatePassword).toHaveBeenCalledOnce();
    });
  });
});

/**
 * Spec `user-management` — "User Creation with Role Assignment" and "Initial
 * Password — Admin-Entered, Forced Change on First Login".
 */
describe("createUser", () => {
  function deps(overrides: Record<string, unknown> = {}) {
    return {
      findByUsername: async () => null,
      findByEmail: async () => null,
      insert: vi.fn().mockResolvedValue({ id: "new-user" }),
      ...overrides,
    };
  }

  it("always flags the new account for a forced password change", async () => {
    const d = deps();

    await createUser({ username: "ana", password: "temporal1", role: "tecnico" }, d);

    expect(d.insert).toHaveBeenCalledOnce();
    expect(d.insert.mock.calls[0][0]).toMatchObject({ username: "ana", role: "tecnico", mustChangePassword: true });
  });

  it("stores a hash, never the admin-entered plaintext", async () => {
    const d = deps();

    await createUser({ username: "ana", password: "temporal1", role: "tecnico" }, d);

    const written = d.insert.mock.calls[0][0] as { passwordHash: string };
    expect(written.passwordHash).not.toBe("temporal1");
    expect(written.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("creates with name and email when supplied", async () => {
    const d = deps();

    await createUser(
      { username: "ana", password: "temporal1", role: "administrador", name: "Ana Ruiz", email: "ana@taller.com" },
      d,
    );

    expect(d.insert.mock.calls[0][0]).toMatchObject({
      name: "Ana Ruiz",
      email: "ana@taller.com",
      role: "administrador",
    });
  });

  it("creates with name and email left unset when omitted", async () => {
    const d = deps();

    await createUser({ username: "ana", password: "temporal1", role: "tecnico" }, d);

    expect(d.insert.mock.calls[0][0]).toMatchObject({ name: null, email: null });
  });

  it("rejects a duplicate username and writes nothing", async () => {
    const d = deps({ findByUsername: async () => ({ id: "existing" }) });

    await expect(
      createUser({ username: "ana", password: "temporal1", role: "tecnico" }, d),
    ).rejects.toThrow(DuplicateUsernameError);
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email and writes nothing", async () => {
    const d = deps({ findByEmail: async () => ({ id: "existing" }) });

    await expect(
      createUser({ username: "ana", password: "temporal1", role: "tecnico", email: "taken@taller.com" }, d),
    ).rejects.toThrow(DuplicateEmailError);
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty username in Spanish", async () => {
    const d = deps();

    await expectProfileErrors(createUser({ username: "   ", password: "temporal1", role: "tecnico" }, d), {
      username: "El nombre de usuario es obligatorio.",
    });
    expect(d.insert).not.toHaveBeenCalled();
  });

  // Same floor as the self-service change, sourced from one exported constant
  // so the admin-create path cannot drift below what users must meet later.
  it("rejects an initial password shorter than the self-service minimum, in Spanish", async () => {
    const d = deps();

    await expectProfileErrors(createUser({ username: "ana", password: "abc", role: "tecnico" }, d), {
      password: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown role rather than trusting the caller, in Spanish", async () => {
    const d = deps();

    await expectProfileErrors(
      createUser({ username: "ana", password: "temporal1", role: "superadmin" as never }, d),
      { role: "El rol debe ser tecnico o administrador." },
    );
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("rejects a malformed email in Spanish", async () => {
    const d = deps();

    await expectProfileErrors(
      createUser({ username: "ana", password: "temporal1", role: "tecnico", email: "not-an-email" }, d),
      { email: "El email no es válido." },
    );
    expect(d.insert).not.toHaveBeenCalled();
  });
});

/**
 * Spec `user-management` — "Editing an Existing User" and "Admin Password
 * Reset Re-Arms Forced Change". The active-admin read and the write share one
 * transaction for the same reason `deactivateUser()` does: two admins
 * concurrently demoting each other must not both observe a stale count.
 */
describe("updateUser", () => {
  function txDeps(overrides: Record<string, unknown> = {}) {
    const applyUpdate = vi.fn().mockResolvedValue(undefined);
    const revoke = vi.fn().mockResolvedValue(undefined);
    return {
      applyUpdate,
      revoke,
      deps: {
        // Structurally matches the module's execute-only TxLike seam, so the
        // transaction boundary is exercised without a live Postgres.
        database: {
          transaction: async <T>(fn: (tx: { execute: () => Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>) =>
            fn({ execute: async () => ({ rows: [] }) }),
        },
        getTarget: async () => ({ role: "tecnico" as const, email: null }),
        listActiveAdminIds: async () => ["admin-1", "admin-2"],
        findByEmail: async () => null,
        applyUpdate,
        revokeOtherSessions: revoke,
        ...overrides,
      },
    };
  }

  it("persists name, email and role edits", async () => {
    const { applyUpdate, deps } = txDeps();

    await updateUser("admin-1", "user-9", { name: "Ana Ruiz", email: "ana@taller.com", role: "administrador" }, deps);

    expect(applyUpdate.mock.calls[0][2]).toMatchObject({
      name: "Ana Ruiz",
      email: "ana@taller.com",
      role: "administrador",
    });
  });

  it("does not touch the password or the forced-change flag on a plain edit", async () => {
    const { applyUpdate, revoke, deps } = txDeps();

    await updateUser("admin-1", "user-9", { name: "Ana Ruiz" }, deps);

    const patch = applyUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("passwordHash");
    expect(patch).not.toHaveProperty("mustChangePassword");
    expect(revoke).not.toHaveBeenCalled();
  });

  describe("admin password reset", () => {
    it("re-arms the forced change and kills every session of the target", async () => {
      const { applyUpdate, revoke, deps } = txDeps();

      await updateUser("admin-1", "user-9", { password: "nuevatemp1" }, deps);

      const patch = applyUpdate.mock.calls[0][2] as { passwordHash: string; mustChangePassword: boolean };
      expect(patch.mustChangePassword).toBe(true);
      expect(patch.passwordHash).not.toBe("nuevatemp1");
      // null, not a keep-token: the admin is resetting SOMEONE ELSE's password,
      // so none of the target's sessions may survive.
      expect(revoke).toHaveBeenCalledWith("user-9", null);
    });

    it("rejects a reset password below the shared minimum in Spanish, and writes nothing", async () => {
      const { applyUpdate, revoke, deps } = txDeps();

      await expectProfileErrors(updateUser("admin-1", "user-9", { password: "abc" }, deps), {
        password: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      });
      expect(applyUpdate).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    });

  });

  describe("admin-safety on role changes", () => {
    it("refuses to demote the last active administrador", async () => {
      const { applyUpdate, deps } = txDeps({
        getTarget: async () => ({ role: "administrador" as const, email: null }),
        listActiveAdminIds: async () => ["user-9"],
      });

      await expect(
        updateUser("admin-1", "user-9", { role: "tecnico" }, deps),
      ).rejects.toThrow(AdminSafetyError);
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    it("refuses to let an actor change their own role through this surface", async () => {
      const { applyUpdate, deps } = txDeps({
        getTarget: async () => ({ role: "administrador" as const, email: null }),
      });

      await expect(
        updateUser("admin-1", "admin-1", { role: "tecnico" }, deps),
      ).rejects.toThrow(AdminSafetyError);
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    it("allows demoting an administrador while another active one remains", async () => {
      const { applyUpdate, deps } = txDeps({
        getTarget: async () => ({ role: "administrador" as const, email: null }),
        listActiveAdminIds: async () => ["user-9", "admin-1"],
      });

      await updateUser("admin-1", "user-9", { role: "tecnico" }, deps);

      expect(applyUpdate).toHaveBeenCalledOnce();
    });

    // The guard blocks self-role-change, not self-edit. An admin renaming
    // themselves must not be caught by it.
    it("does not invoke the guard when the role is unchanged", async () => {
      const listActiveAdminIds = vi.fn().mockResolvedValue(["admin-1"]);
      const { applyUpdate, deps } = txDeps({
        getTarget: async () => ({ role: "administrador" as const, email: null }),
        listActiveAdminIds,
      });

      await updateUser("admin-1", "admin-1", { name: "Nuevo Nombre", role: "administrador" }, deps);

      expect(listActiveAdminIds).not.toHaveBeenCalled();
      expect(applyUpdate).toHaveBeenCalledOnce();
    });
  });

  describe("validation", () => {
    it("rejects a duplicate email belonging to another user", async () => {
      const { applyUpdate, deps } = txDeps({ findByEmail: async () => ({ id: "someone-else" }) });

      await expect(
        updateUser("admin-1", "user-9", { email: "taken@taller.com" }, deps),
      ).rejects.toThrow(DuplicateEmailError);
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    it("accepts an email that already belongs to the target itself", async () => {
      const { applyUpdate, deps } = txDeps({
        getTarget: async () => ({ role: "tecnico" as const, email: "ana@taller.com" }),
        findByEmail: async () => ({ id: "user-9" }),
      });

      await updateUser("admin-1", "user-9", { email: "ana@taller.com" }, deps);

      expect(applyUpdate).toHaveBeenCalledOnce();
    });

    it("rejects a malformed email in Spanish", async () => {
      const { applyUpdate, deps } = txDeps();

      await expectProfileErrors(updateUser("admin-1", "user-9", { email: "not-an-email" }, deps), {
        email: "El email no es válido.",
      });
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    // `updateUser` validates the role on its own line, with its own literal —
    // the `createUser` test above defends a different one. Without this test,
    // reverting `updateUser`'s role message to English leaves the suite green.
    it("rejects an unknown role in Spanish, and writes nothing", async () => {
      const { applyUpdate, deps } = txDeps();

      await expectProfileErrors(updateUser("admin-1", "user-9", { role: "superadmin" as never }, deps), {
        role: "El rol debe ser tecnico o administrador.",
      });
      expect(applyUpdate).not.toHaveBeenCalled();
    });

    it("reports a missing target rather than writing blind", async () => {
      const { applyUpdate, deps } = txDeps({ getTarget: async () => null });

      await expect(
        updateUser("admin-1", "ghost", { name: "X" }, deps),
      ).rejects.toThrow(UserNotFoundError);
      expect(applyUpdate).not.toHaveBeenCalled();
    });
  });
});

/**
 * design.md Decision 7 — pure truth table, no DB. `activeAdminIds` is the
 * caller-supplied "role=administrador AND deactivatedAt IS NULL" snapshot;
 * `checkAdminSafety` itself never queries anything.
 */
describe("checkAdminSafety", () => {
  it("rejects an admin changing their own role, even with other active admins remaining", () => {
    const result = checkAdminSafety({
      actorId: "admin-1",
      targetId: "admin-1",
      operation: "change-role",
      activeAdminIds: ["admin-1", "admin-2"],
    });
    expect(result).toBe("self_role_change");
  });

  it("rejects an admin deactivating themselves, even with other active admins remaining", () => {
    const result = checkAdminSafety({
      actorId: "admin-1",
      targetId: "admin-1",
      operation: "deactivate",
      activeAdminIds: ["admin-1", "admin-2"],
    });
    expect(result).toBe("self_deactivate");
  });

  it("rejects deactivating the last active administrador", () => {
    const result = checkAdminSafety({
      actorId: "admin-2",
      targetId: "admin-1",
      operation: "deactivate",
      activeAdminIds: ["admin-1"],
    });
    expect(result).toBe("last_active_admin");
  });

  it("rejects demoting the last active administrador", () => {
    const result = checkAdminSafety({
      actorId: "admin-2",
      targetId: "admin-1",
      operation: "change-role",
      activeAdminIds: ["admin-1"],
    });
    expect(result).toBe("last_active_admin");
  });

  it("excludes an already-deactivated admin from the floor — demoting them is a no-op, not a violation", () => {
    const result = checkAdminSafety({
      actorId: "admin-2",
      targetId: "already-deactivated-admin",
      operation: "change-role",
      activeAdminIds: ["admin-2"],
    });
    expect(result).toBeNull();
  });

  it("allows deactivating one of two active admins", () => {
    const result = checkAdminSafety({
      actorId: "admin-1",
      targetId: "admin-2",
      operation: "deactivate",
      activeAdminIds: ["admin-1", "admin-2"],
    });
    expect(result).toBeNull();
  });

  it("allows demoting one of two active admins", () => {
    const result = checkAdminSafety({
      actorId: "admin-1",
      targetId: "admin-2",
      operation: "change-role",
      activeAdminIds: ["admin-1", "admin-2"],
    });
    expect(result).toBeNull();
  });

  it("allows an admin to deactivate a non-admin target regardless of admin count", () => {
    const result = checkAdminSafety({
      actorId: "admin-1",
      targetId: "tecnico-1",
      operation: "deactivate",
      activeAdminIds: ["admin-1"],
    });
    expect(result).toBeNull();
  });
});

describe("deactivateUser", () => {
  it("reads the active-admin count and writes deactivatedAt inside the SAME transaction, then revokes sessions", async () => {
    const { database, tx, transactionCalls } = fakeTransactionalDatabase();
    const seenTxInRead: unknown[] = [];
    const seenTxInWrite: unknown[] = [];
    const listActiveAdminIds = vi.fn(async (t: unknown) => {
      seenTxInRead.push(t);
      return ["admin-1", "admin-2"];
    });
    const setDeactivatedAt = vi.fn(async (t: unknown) => {
      seenTxInWrite.push(t);
    });
    const revokeOtherSessions = vi.fn().mockResolvedValue(undefined);

    await deactivateUser("admin-1", "admin-2", {
      database,
      listActiveAdminIds,
      setDeactivatedAt,
      revokeOtherSessions,
    });

    // Exactly one transaction() call, and the read + write both received the
    // SAME tx reference — the guarantee `checkAdminSafety`'s design note
    // requires so two concurrent demotions can't both observe a stale count.
    // NOTE: this pins the STRUCTURE (one transaction, shared tx), it does
    // NOT exercise an actual concurrent-admin race — that needs a live
    // Postgres instance and is not exercised in this suite.
    expect(transactionCalls()).toBe(1);
    expect(seenTxInRead[0]).toBe(tx);
    expect(seenTxInWrite[0]).toBe(tx);
    expect(setDeactivatedAt).toHaveBeenCalledWith(tx, "admin-2", expect.any(Date));
    expect(revokeOtherSessions).toHaveBeenCalledWith("admin-2", null);
  });

  it("rejects deactivating the last active administrador — no write, no session revocation", async () => {
    const { database } = fakeTransactionalDatabase();
    const setDeactivatedAt = vi.fn();
    const revokeOtherSessions = vi.fn();

    await expect(
      deactivateUser("admin-2", "admin-1", {
        database,
        listActiveAdminIds: async () => ["admin-1"],
        setDeactivatedAt,
        revokeOtherSessions,
      }),
    ).rejects.toBeInstanceOf(AdminSafetyError);

    expect(setDeactivatedAt).not.toHaveBeenCalled();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("rejects an admin deactivating themselves when they are the last active admin", async () => {
    const { database } = fakeTransactionalDatabase();
    const setDeactivatedAt = vi.fn();
    const revokeOtherSessions = vi.fn();

    await expect(
      deactivateUser("admin-1", "admin-1", {
        database,
        listActiveAdminIds: async () => ["admin-1"],
        setDeactivatedAt,
        revokeOtherSessions,
      }),
    ).rejects.toMatchObject({ reason: "self_deactivate" });

    expect(setDeactivatedAt).not.toHaveBeenCalled();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("allows deactivating a non-last active admin", async () => {
    const { database } = fakeTransactionalDatabase();
    const setDeactivatedAt = vi.fn();
    const revokeOtherSessions = vi.fn().mockResolvedValue(undefined);

    await deactivateUser("admin-1", "admin-2", {
      database,
      listActiveAdminIds: async () => ["admin-1", "admin-2"],
      setDeactivatedAt,
      revokeOtherSessions,
    });

    expect(setDeactivatedAt).toHaveBeenCalledWith(expect.anything(), "admin-2", expect.any(Date));
    expect(revokeOtherSessions).toHaveBeenCalledWith("admin-2", null);
  });
});

describe("reactivateUser", () => {
  it("clears deactivatedAt without touching admin safety or session revocation", async () => {
    const setDeactivatedAt = vi.fn().mockResolvedValue(undefined);

    await reactivateUser("user-1", { setDeactivatedAt });

    expect(setDeactivatedAt).toHaveBeenCalledWith("user-1", null);
  });
});
