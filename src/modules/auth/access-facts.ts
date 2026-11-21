import { and, eq, inArray, max } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { loginAttempts, userTotp } from "@/shared/db/schema";

/** A user's 2FA row (`enrolling` while unconfirmed) and latest successful login, for Gestión de usuarios. */
export type UserAccessFacts = { twoFactor: "enabled" | "enrolling" | null; lastAccessAt: Date | null };

/**
 * Two queries for the whole list, never one per row (login-hardening T10).
 * Every id gets an entry, so a user with neither row reads as no 2FA and "—".
 */
export async function userAccessFacts(userIds: string[]): Promise<Map<string, UserAccessFacts>> {
  const facts = new Map<string, UserAccessFacts>(userIds.map((id) => [id, { twoFactor: null, lastAccessAt: null }]));
  if (userIds.length === 0) return facts;

  const totp = await db
    .select({ userId: userTotp.userId, enabledAt: userTotp.enabledAt })
    .from(userTotp)
    .where(inArray(userTotp.userId, userIds));
  for (const row of totp) facts.get(row.userId)!.twoFactor = row.enabledAt ? "enabled" : "enrolling";

  const access = await db
    .select({ userId: loginAttempts.userId, at: max(loginAttempts.at) })
    .from(loginAttempts)
    .where(and(inArray(loginAttempts.userId, userIds), eq(loginAttempts.outcome, "success")))
    .groupBy(loginAttempts.userId);
  for (const row of access) facts.get(row.userId!)!.lastAccessAt = row.at;

  return facts;
}
