import { describe, expect, it, vi } from "vitest";

import { changePassword, updateProfile, ProfileValidationError, DuplicateEmailError } from "./service";

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
