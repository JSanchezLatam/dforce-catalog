/**
 * service-orders/correction-auth.ts — re-authenticates an administrator before
 * a correction to a closed order (closed-order-lock). Runs in the route,
 * OUTSIDE the transaction: bcrypt cost 12 must not hold the order row lock.
 *
 * Order matters: throttle, then the users lookup, then bcrypt. The role and the
 * hash both come from ONE `users` row read by SESSION id, so the password
 * checked is always the signed-in user's own.
 *
 * ponytail: the throttle is in-memory and per process (resets on restart). The
 * deployment is one process; move it to a table if the app ever runs two.
 */
import { eq } from "drizzle-orm";

import { can } from "@/modules/auth/policy";
import { verifyPassword } from "@/modules/auth/password";
import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";
import type { CorrectionGrant } from "./order-lock";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export class CorrectionRefusedError extends Error {
  constructor(public readonly reason: "throttled" | "wrong_password" | "not_admin") {
    super(`Correction refused: ${reason}`);
  }
}

export type CorrectionAuthDeps = {
  now?: () => number;
  findUser?: (id: string) => Promise<{ role: string; deactivatedAt: Date | null; passwordHash: string } | null>;
  verifyPassword?: (plain: string, hash: string) => Promise<boolean>;
};

const failures = new Map<string, number[]>();

async function findUserById(id: string) {
  const [row] = await db
    .select({ role: users.role, deactivatedAt: users.deactivatedAt, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

export async function authorizeCorrection(
  userId: string,
  password: string,
  deps: CorrectionAuthDeps = {},
): Promise<CorrectionGrant> {
  const now = (deps.now ?? Date.now)();
  const recent = (failures.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_FAILURES) throw new CorrectionRefusedError("throttled");

  // Reserve the attempt BEFORE any await: concurrent guesses would otherwise all read the
  // same list and each write back one entry, so a parallel batch counted as a single failure.
  failures.set(userId, [...recent, now]);

  const user = await (deps.findUser ?? findUserById)(userId);
  if (!user || user.deactivatedAt || !can(user, "service-orders.correct")) {
    // No password was guessed, so the reservation must not throttle a legitimate attempt.
    const held = failures.get(userId) ?? [];
    const at = held.indexOf(now);
    if (at >= 0) failures.set(userId, held.toSpliced(at, 1));
    throw new CorrectionRefusedError("not_admin");
  }

  if (!(await (deps.verifyPassword ?? verifyPassword)(password, user.passwordHash))) {
    throw new CorrectionRefusedError("wrong_password");
  }
  failures.delete(userId);
  return { correctorId: userId };
}
