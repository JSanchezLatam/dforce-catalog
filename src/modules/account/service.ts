import { eq, sql } from "drizzle-orm";

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

export type AdminSafetyOperation = "change-role" | "deactivate";
export type AdminSafetyViolation = "self_role_change" | "self_deactivate" | "last_active_admin";

/**
 * design.md Decision 7 — pure, no DB. Covers three dangerous admin mutations
 * (self-role-change, self-deactivate, last-active-admin) with ONE function so
 * `deactivateUser()` and the future WU4a `updateUser()` role-change path
 * share a single source of truth.
 *
 * Rules, in order:
 * 1. An actor may never change or deactivate their OWN account through this
 *    admin-management surface, regardless of how many other active admins
 *    remain — self-service edits go through `/account`, not `/users`.
 * 2. No operation may reduce the active-administrador count to zero.
 *    "Active administrador" = role=administrador AND deactivatedAt IS NULL
 *    (`activeAdminIds`, from `listActiveAdminIds()`) — an already-deactivated
 *    admin does not count toward this floor, so demoting one is a no-op.
 */
export function checkAdminSafety(input: {
  actorId: string;
  targetId: string;
  operation: AdminSafetyOperation;
  activeAdminIds: readonly string[];
}): AdminSafetyViolation | null {
  const { actorId, targetId, operation, activeAdminIds } = input;

  if (actorId === targetId) {
    return operation === "change-role" ? "self_role_change" : "self_deactivate";
  }

  const targetIsLastActiveAdmin = activeAdminIds.includes(targetId) && activeAdminIds.length <= 1;
  if (targetIsLastActiveAdmin) {
    return "last_active_admin";
  }

  return null;
}

/** Thrown by `deactivateUser()`/(WU4a's) `updateUser()` when `checkAdminSafety()` rejects the mutation. */
export class AdminSafetyError extends Error {
  constructor(public readonly reason: AdminSafetyViolation) {
    super(`Admin safety violation: ${reason}`);
  }
}

/**
 * Raw-SQL `TxLike` seam — same convention as pdf-generation/enqueue.ts and
 * catalog-storage/retention.ts's transaction-scoped queries: keeps the
 * transaction dependency mockable with a minimal execute-only fake in unit
 * tests, no real Postgres needed.
 */
type TxLike = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> };

async function listActiveAdminIdsTx(tx: TxLike): Promise<string[]> {
  const result = await tx.execute(
    sql`SELECT id FROM users WHERE role = 'administrador' AND deactivated_at IS NULL`,
  );
  return result.rows.map((row) => String(row.id));
}

async function setDeactivatedAtTx(tx: TxLike, targetId: string, deactivatedAt: Date): Promise<void> {
  await tx.execute(sql`UPDATE users SET deactivated_at = ${deactivatedAt} WHERE id = ${targetId}`);
}

/**
 * Soft-deactivate only — never deletes the `users` row (design.md Decision 7
 * / spec "Deactivation Is Soft, Never Delete"), so `orden_servicio.createdBy`
 * keeps referencing this user unchanged on every historical record.
 *
 * The active-admin count READ and the `deactivated_at` WRITE run inside ONE
 * `db.transaction()` — required so two admins concurrently demoting/
 * deactivating each other cannot both observe a stale count and both land on
 * zero active administrators (design.md Decision 7's documented race).
 * `revokeOtherSessions()` runs AFTER the transaction commits, mirroring the
 * already-designed `deactivateUser()`/`changePassword()` pattern elsewhere in
 * this module — the session table has no bearing on the admin-count
 * invariant the transaction protects, so it does not need to share it.
 */
export async function deactivateUser(
  actorId: string,
  targetId: string,
  deps: {
    database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
    listActiveAdminIds?: (tx: TxLike) => Promise<string[]>;
    setDeactivatedAt?: (tx: TxLike, targetId: string, deactivatedAt: Date) => Promise<void>;
    revokeOtherSessions?: typeof revokeOtherSessions;
  } = {},
): Promise<void> {
  const database = deps.database ?? db;
  const getActiveAdminIds = deps.listActiveAdminIds ?? listActiveAdminIdsTx;
  const setDeactivatedAt = deps.setDeactivatedAt ?? setDeactivatedAtTx;

  await database.transaction(async (tx) => {
    const activeAdminIds = await getActiveAdminIds(tx);
    const violation = checkAdminSafety({ actorId, targetId, operation: "deactivate", activeAdminIds });
    if (violation) {
      throw new AdminSafetyError(violation);
    }
    await setDeactivatedAt(tx, targetId, new Date());
  });

  const revoke = deps.revokeOtherSessions ?? revokeOtherSessions;
  await revoke(targetId, null);
}

/**
 * Inverse of `deactivateUser()` (design-r4 decision — reactivation is in
 * scope). Never calls `checkAdminSafety()`: increasing the active-admin
 * count can never violate the last-active-admin floor, so no transaction is
 * needed either. No session revocation — a deactivated user has no live
 * session to revoke (validateSession() already refuses one, and
 * deactivateUser() already revoked whatever existed at deactivation time).
 */
export async function reactivateUser(
  targetId: string,
  deps: { setDeactivatedAt?: (targetId: string, deactivatedAt: null) => Promise<void> } = {},
): Promise<void> {
  if (deps.setDeactivatedAt) {
    await deps.setDeactivatedAt(targetId, null);
    return;
  }
  await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, targetId));
}
