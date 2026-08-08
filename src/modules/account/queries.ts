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
