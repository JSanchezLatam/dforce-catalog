import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";

import { takeLoginLocks } from "./login-attempts";
import { loginKey } from "./login-lock";
import { revokeTrustedDevices } from "./trusted-device";

/**
 * An administrator's 2FA reset of another user (S5, A5, L49). In one
 * transaction it deletes the app secret, the recovery codes and the trusted
 * devices, and revokes every session, pending ones included, so nothing the
 * old factor opened survives. A mandatory role enrols again at its next login
 * (T8b). It first takes the target's login lock, which a second-step code
 * check holds (L33), so a check cannot issue a session in the middle of a
 * reset. `scripts/emergency.mjs reset-2fa` repeats all of this in plain SQL.
 */

export type ResetTwoFactorResult = { ok: true } | { ok: false; reason: "self_reset" | "not_found" };

export async function resetTwoFactor(
  actorId: string,
  targetId: string,
  deps: { transaction?: typeof db.transaction } = {},
): Promise<ResetTwoFactorResult> {
  if (actorId === targetId) return { ok: false, reason: "self_reset" };
  const transaction = deps.transaction ?? db.transaction.bind(db);

  return transaction(async (tx) => {
    const found = await tx.select({ username: users.username }).from(users).where(eq(users.id, targetId)).limit(1);
    if (found.length === 0) return { ok: false, reason: "not_found" } as const;
    await takeLoginLocks(tx, { username: loginKey(found[0].username), ip: null });

    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, targetId));
    await tx.delete(userTotp).where(eq(userTotp.userId, targetId));
    await revokeTrustedDevices(targetId, tx);
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, targetId), isNull(sessions.revokedAt)));
    return { ok: true } as const;
  });
}
