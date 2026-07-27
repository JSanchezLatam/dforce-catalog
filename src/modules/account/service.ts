import { eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";
import { revokeOtherSessions } from "@/modules/auth/session";
import { hashPassword, verifyPassword } from "@/modules/auth/password";

export type ProfileInput = {
  name?: string | null;
  email?: string | null;
};

export async function updateProfile(
  userId: string,
  data: ProfileInput,
  updateFn?: (uid: string, d: ProfileInput) => Promise<void>,
): Promise<void> {
  if (updateFn) return updateFn(userId, data);
  await db.update(users).set({ name: data.name ?? null, email: data.email ?? null }).where(eq(users.id, userId));
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
