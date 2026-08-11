import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";

export type UserProfile = {
  username: string;
  name: string | null;
  email: string | null;
  role: string;
};

export async function getUserProfile(
  userId: string,
  queryFn: () => Promise<UserProfile | null> = async () => {
    const row = await db
      .select({ username: users.username, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row[0] ?? null;
  },
): Promise<UserProfile | null> {
  return queryFn();
}

/** One row of the admin `/users` list. `deactivatedAt` is exposed (not folded into a boolean) so the UI can show WHEN access was lost, which an audit needs. */
export type AdminUserRow = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  deactivatedAt: Date | null;
};

/**
 * Spec `user-management` — the admin user list. Active-only by DEFAULT: the
 * "Mostrar inactivos" toggle is opt-in, so a caller that forgets the flag gets
 * the safe, smaller set rather than silently listing deactivated accounts.
 *
 * `includeInactive` is threaded into `queryFn` instead of the caller swapping
 * the whole query, so the default is observable in a DB-free test.
 */
export async function listUsers(
  options: { includeInactive?: boolean } = {},
  queryFn: (includeInactive: boolean) => Promise<AdminUserRow[]> = async (includeInactive) => {
    const projection = {
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
    };
    const query = db.select(projection).from(users);
    return includeInactive ? query : query.where(isNull(users.deactivatedAt));
  },
): Promise<AdminUserRow[]> {
  return queryFn(options?.includeInactive ?? false);
}

/**
 * design.md Decision 7 — "active administrador" means `role = 'administrador'
 * AND deactivatedAt IS NULL`; a deactivated admin does not count toward the
 * floor `checkAdminSafety()` enforces. `queryFn` is injectable so callers
 * (notably `service.ts`'s transaction-wrapped `deactivateUser()`) can read
 * this count against a specific `tx`, not the module-level `db`.
 */
export async function listActiveAdminIds(
  queryFn: () => Promise<string[]> = async () => {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "administrador"), isNull(users.deactivatedAt)));
    return rows.map((row) => row.id);
  },
): Promise<string[]> {
  return queryFn();
}
