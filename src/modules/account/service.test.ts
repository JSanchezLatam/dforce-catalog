import { describe, expect, it, vi } from "vitest";

import { changePassword, updateProfile, ProfileValidationError, DuplicateEmailError, checkAdminSafety } from "./service";

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
