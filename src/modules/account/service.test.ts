import { describe, expect, it, vi } from "vitest";

import {
  changePassword,
  updateProfile,
  ProfileValidationError,
  DuplicateEmailError,
  checkAdminSafety,
  deactivateUser,
  reactivateUser,
  AdminSafetyError,
} from "./service";

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

  it("rejects an invalid email format and does NOT persist", async () => {
    const fn = vi.fn();
    await expect(
      updateProfile("user-1", { name: "Juan", email: "not-an-email" }, fn, {
        getCurrentEmail: async () => null,
        findByEmail: async () => null,
      }),
    ).rejects.toThrow(ProfileValidationError);
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
  it("rejects wrong current password and does NOT call updateHash", async () => {
    const updateHash = vi.fn();
    await expect(
      changePassword("user-1", "wrong", "new-pass", "token-1", {
        getHash: async () => "$2b$12$hash_of_correct_password",
        updateHash,
        revoke: vi.fn(),
      }),
    ).rejects.toThrow("Invalid current password");
    expect(updateHash).not.toHaveBeenCalled();
  });

  it("updates hash and revokes other sessions on correct password", async () => {
    const updateHash = vi.fn();
    const revoke = vi.fn();
    const { hashPassword } = await import("@/modules/auth/password");
    const realHash = await hashPassword("correct-pass");

    await changePassword("user-1", "correct-pass", "new-pass", "token-1", {
      getHash: async () => realHash,
      updateHash,
      revoke,
    });

    expect(updateHash).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("user-1", "token-1");
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
