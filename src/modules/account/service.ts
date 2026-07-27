import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";
import { revokeOtherSessions } from "@/modules/auth/session";
import { hashPassword, verifyPassword } from "@/modules/auth/password";

/** Mirrors customers/validation.ts's EMAIL_FORMAT convention. */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProfileInput = {
  name?: string | null;
  email?: string | null;
};

export class ProfileValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid profile input");
  }
}

/** Spec: `user-account` "Email Validation" — duplicate email across users. */
export class DuplicateEmailError extends Error {
  constructor() {
    super("Email is already in use by another account");
  }
}

export type UpdateProfileDeps = {
  getCurrentEmail?: (uid: string) => Promise<string | null>;
  findByEmail?: (email: string) => Promise<{ id: string } | null>;
};

export async function updateProfile(
  userId: string,
  data: ProfileInput,
  updateFn?: (uid: string, d: ProfileInput) => Promise<void>,
  deps?: UpdateProfileDeps,
): Promise<void> {
  const email = data.email ?? null;

  if (email !== null && email !== "") {
    if (!EMAIL_FORMAT.test(email)) {
      throw new ProfileValidationError({ email: "Email must be a valid email address" });
    }

    const getCurrentEmail =
      deps?.getCurrentEmail ??
      (async (uid: string) =>
        (await db.select({ email: users.email }).from(users).where(eq(users.id, uid)).limit(1))[0]?.email ?? null);
    const currentEmail = await getCurrentEmail(userId);

    if (email !== currentEmail) {
      const findByEmail =
        deps?.findByEmail ??
        (async (e: string) =>
          (await db.select({ id: users.id }).from(users).where(eq(users.email, e)).limit(1))[0] ?? null);
      const existing = await findByEmail(email);
      if (existing && existing.id !== userId) {
        throw new DuplicateEmailError();
      }
    }
  }

  if (updateFn) return updateFn(userId, data);
  await db.update(users).set({ name: data.name ?? null, email }).where(eq(users.id, userId));
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentTokenId: string,
  deps?: {
    getHash?: (uid: string) => Promise<string | null>;
    updateHash?: (uid: string, hash: string) => Promise<void>;
    revoke?: (uid: string, keep: string | null) => Promise<void>;
  },
): Promise<void> {
  const hash = deps?.getHash
    ? await deps.getHash(userId)
    : (await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1))[0]?.passwordHash ?? null;

  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    throw new Error("Invalid current password");
  }

  const newHash = await hashPassword(newPassword);

  if (deps?.updateHash) {
    await deps.updateHash(userId, newHash);
  } else {
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
  }

  if (deps?.revoke) {
    await deps.revoke(userId, currentTokenId);
  } else {
    await revokeOtherSessions(userId, currentTokenId);
  }
}
