import { eq, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";
import { revokeOtherSessions } from "@/modules/auth/session";
import { isRole, type Role } from "@/modules/auth/roles";
import { MIN_PASSWORD_LENGTH } from "./password-policy";
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

/**
 * `users.username` is UNIQUE in the schema and is the login identifier, so a
 * collision is a routine admin mistake, not an exceptional one. Without this
 * the insert surfaces a raw Postgres constraint violation as a 500.
 */
export class DuplicateUsernameError extends Error {
  constructor() {
    super("Username is already taken");
  }
}

export { MIN_PASSWORD_LENGTH };

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
      throw new ProfileValidationError({ email: "El email no es válido." });
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

/** Spec `user-account` — "New Password Must Differ From the Temporary One". */
export class SamePasswordError extends Error {
  constructor() {
    super("New password must differ from the current one");
  }
}

/** What the single credential read returns — the DB-free test seam's contract. */
export type Credentials = { passwordHash: string; mustChangePassword: boolean };

/**
 * `mustChangePassword` rides along on the SELECT that already fetches the hash
 * — zero extra queries, the same free ride design.md Decision 8 takes in
 * `validateSession()`.
 *
 * The forced-rotation rule is derived from that flag rather than passed in by
 * the caller on purpose: `parseSessionUser()` does not forward the flag to
 * route handlers, so no caller could supply it, and a rule a caller can forget
 * to pass is not a rule. Self-service behaviour is unchanged — an unflagged
 * user may still "change" their password to the same value.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentTokenId: string,
  deps?: {
    getCredentials?: (uid: string) => Promise<Credentials | null>;
    updatePassword?: (uid: string, hash: string) => Promise<void>;
    revoke?: (uid: string, keep: string | null) => Promise<void>;
  },
): Promise<void> {
  const credentials = deps?.getCredentials
    ? await deps.getCredentials(userId)
    : (await db
        .select({ passwordHash: users.passwordHash, mustChangePassword: users.mustChangePassword })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1))[0] ?? null;

  // Current-password verification runs FIRST, before the same-password check,
  // so an attacker cannot use the "must differ" error to probe whether a
  // guessed password is the account's current one.
  if (!credentials || !(await verifyPassword(currentPassword, credentials.passwordHash))) {
    throw new Error("Invalid current password");
  }

  if (credentials.mustChangePassword && newPassword === currentPassword) {
    throw new SamePasswordError();
  }

  const newHash = await hashPassword(newPassword);

  if (deps?.updatePassword) {
    await deps.updatePassword(userId, newHash);
  } else {
    // One UPDATE, both columns: a rotated password can never commit while the
    // flag stays set, which would lock the user out of the app they just
    // unlocked. Clearing the flag for an already-unflagged user is a harmless
    // no-op, so this needs no conditional.
    await db
      .update(users)
      .set({ passwordHash: newHash, mustChangePassword: false })
      .where(eq(users.id, userId));
  }

  if (deps?.revoke) {
    await deps.revoke(userId, currentTokenId);
  } else {
    await revokeOtherSessions(userId, currentTokenId);
  }
}

export type CreateUserInput = {
  username: string;
  password: string;
  role: Role;
  name?: string | null;
  email?: string | null;
};

export type CreateUserDeps = {
  findByUsername?: (username: string) => Promise<{ id: string } | null>;
  findByEmail?: (email: string) => Promise<{ id: string } | null>;
  insert?: (row: {
    username: string;
    passwordHash: string;
    role: Role;
    name: string | null;
    email: string | null;
    mustChangePassword: boolean;
  }) => Promise<{ id: string }>;
};

/**
 * Spec `user-management` — admin creates a user with an admin-entered initial
 * password. `mustChangePassword` is set unconditionally at creation (design.md
 * Decision 8): the admin necessarily knows the password they just typed, and
 * that is exactly the exposure the forced rotation closes.
 *
 * Every validation runs BEFORE the hash is computed and before any write, so a
 * rejected create costs no bcrypt round and leaves nothing behind.
 */
export async function createUser(input: CreateUserInput, deps: CreateUserDeps = {}): Promise<{ id: string }> {
  const username = input.username?.trim() ?? "";
  const email = input.email?.trim() || null;
  const errors: Record<string, string> = {};

  if (!username) errors.username = "El nombre de usuario es obligatorio.";
  if (!isRole(input.role)) errors.role = "El rol debe ser tecnico o administrador.";
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (email !== null && !EMAIL_FORMAT.test(email)) {
    errors.email = "El email no es válido.";
  }
  if (Object.keys(errors).length > 0) throw new ProfileValidationError(errors);

  const findByUsername =
    deps.findByUsername ??
    (async (u: string) =>
      (await db.select({ id: users.id }).from(users).where(eq(users.username, u)).limit(1))[0] ?? null);
  if (await findByUsername(username)) throw new DuplicateUsernameError();

  if (email !== null) {
    const findByEmail =
      deps.findByEmail ??
      (async (e: string) =>
        (await db.select({ id: users.id }).from(users).where(eq(users.email, e)).limit(1))[0] ?? null);
    if (await findByEmail(email)) throw new DuplicateEmailError();
  }

  const row = {
    username,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    name: input.name?.trim() || null,
    email,
    mustChangePassword: true,
  };

  const insert =
    deps.insert ??
    (async (r: typeof row) => (await db.insert(users).values(r).returning({ id: users.id }))[0]);
  return insert(row);
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

/**
 * Builds the SET clause from only the keys the caller actually supplied, so an
 * edit that touches one field cannot silently null out the others.
 *
 * `role` needs the explicit `::role` cast: the column is a Postgres enum and a
 * bound text parameter is not implicitly coercible to it.
 */
async function applyUserPatchTx(tx: TxLike, targetId: string, patch: UserPatch): Promise<void> {
  const assignments = [];
  if (patch.name !== undefined) assignments.push(sql`name = ${patch.name}`);
  if (patch.email !== undefined) assignments.push(sql`email = ${patch.email}`);
  if (patch.role !== undefined) assignments.push(sql`role = ${patch.role}::role`);
  if (patch.passwordHash !== undefined) assignments.push(sql`password_hash = ${patch.passwordHash}`);
  if (patch.mustChangePassword !== undefined) {
    assignments.push(sql`must_change_password = ${patch.mustChangePassword}`);
  }
  if (assignments.length === 0) return;

  await tx.execute(sql`UPDATE users SET ${sql.join(assignments, sql`, `)} WHERE id = ${targetId}`);
}

async function setDeactivatedAtTx(tx: TxLike, targetId: string, deactivatedAt: Date): Promise<void> {
  await tx.execute(sql`UPDATE users SET deactivated_at = ${deactivatedAt} WHERE id = ${targetId}`);
}

/** Thrown when the target of an admin edit does not exist — the route maps it to 404 rather than writing blind. */
export class UserNotFoundError extends Error {
  constructor() {
    super("User not found");
  }
}

export type UpdateUserInput = {
  name?: string | null;
  email?: string | null;
  role?: Role;
  /** Present only on an admin password reset — absent means "leave the password alone". */
  password?: string;
};

type UserPatch = {
  name?: string | null;
  email?: string | null;
  role?: Role;
  passwordHash?: string;
  mustChangePassword?: boolean;
};

export type UpdateUserDeps = {
  database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
  getTarget?: (tx: TxLike, targetId: string) => Promise<{ role: Role; email: string | null } | null>;
  listActiveAdminIds?: (tx: TxLike) => Promise<string[]>;
  findByEmail?: (email: string) => Promise<{ id: string } | null>;
  applyUpdate?: (tx: TxLike, targetId: string, patch: UserPatch) => Promise<void>;
  revokeOtherSessions?: typeof revokeOtherSessions;
};

async function getTargetTx(tx: TxLike, targetId: string) {
  const result = await tx.execute(sql`SELECT role, email FROM users WHERE id = ${targetId} LIMIT 1`);
  const row = result.rows[0];
  return row ? { role: String(row.role) as Role, email: row.email === null ? null : String(row.email) } : null;
}

/**
 * Spec `user-management` — admin edits another user's name, email, role, and
 * optionally resets their password.
 *
 * The active-admin read and the write share ONE transaction, same as
 * `deactivateUser()`: without it two admins concurrently demoting each other
 * both read a stale count and both succeed, leaving zero administrators.
 *
 * The safety guard runs ONLY when the role actually changes. An admin editing
 * their own name through this surface is not a self-role-change and must not
 * be blocked by it.
 */
export async function updateUser(
  actorId: string,
  targetId: string,
  input: UpdateUserInput,
  deps: UpdateUserDeps = {},
): Promise<void> {
  const email = input.email?.trim() ?? undefined;
  const errors: Record<string, string> = {};

  if (input.role !== undefined && !isRole(input.role)) {
    errors.role = "El rol debe ser tecnico o administrador.";
  }
  if (input.password !== undefined && input.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (email !== undefined && email !== "" && !EMAIL_FORMAT.test(email)) {
    errors.email = "El email no es válido.";
  }
  if (Object.keys(errors).length > 0) throw new ProfileValidationError(errors);

  // Hash outside the transaction: bcrypt at cost >= 12 is deliberately slow,
  // and holding a row lock for its duration would serialise unrelated admin
  // edits behind it.
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

  const database = deps.database ?? db;
  const getTarget = deps.getTarget ?? getTargetTx;
  const getActiveAdminIds = deps.listActiveAdminIds ?? listActiveAdminIdsTx;
  const applyUpdate = deps.applyUpdate ?? applyUserPatchTx;

  await database.transaction(async (tx) => {
    const target = await getTarget(tx, targetId);
    if (!target) throw new UserNotFoundError();

    if (input.role !== undefined && input.role !== target.role) {
      const activeAdminIds = await getActiveAdminIds(tx);
      const violation = checkAdminSafety({ actorId, targetId, operation: "change-role", activeAdminIds });
      if (violation) throw new AdminSafetyError(violation);
    }

    if (email !== undefined && email !== "" && email !== target.email) {
      const findByEmail =
        deps.findByEmail ??
        (async (e: string) =>
          (await db.select({ id: users.id }).from(users).where(eq(users.email, e)).limit(1))[0] ?? null);
      const existing = await findByEmail(email);
      if (existing && existing.id !== targetId) throw new DuplicateEmailError();
    }

    const patch: UserPatch = {};
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (email !== undefined) patch.email = email || null;
    if (input.role !== undefined) patch.role = input.role;
    if (passwordHash !== undefined) {
      patch.passwordHash = passwordHash;
      // Spec "Admin Password Reset Re-Arms Forced Change" — unconditionally
      // true, regardless of its prior value: the admin now knows this user's
      // password, which is exactly what the forced rotation exists to close.
      patch.mustChangePassword = true;
    }

    await applyUpdate(tx, targetId, patch);
  });

  // After commit, and only for a reset: keepTokenId is null because the admin
  // is resetting SOMEONE ELSE's password, so none of the target's sessions may
  // survive. A plain edit revokes nothing — a role change takes effect on the
  // next request evaluation, per the spec.
  if (passwordHash !== undefined) {
    const revoke = deps.revokeOtherSessions ?? revokeOtherSessions;
    await revoke(targetId, null);
  }
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
