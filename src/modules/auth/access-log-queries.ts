import { and, count, desc, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { loginAttempts, users } from "@/shared/db/schema";

import { RESULT_OUTCOMES, type AccessLogFilters } from "./access-log";
import type { LoginOutcome } from "./login-lock";

/** `username` is null when the typed login matches no user: that text may be a password (S10, L16). */
export type AccessLogRow = { id: string; at: Date; username: string | null; ip: string | null; outcome: LoginOutcome };

const DAY_MS = 24 * 60 * 60 * 1000;

function matching(filters: AccessLogFilters, now: Date) {
  return and(
    gt(loginAttempts.at, new Date(now.getTime() - filters.days * DAY_MS)),
    filters.user ? eq(loginAttempts.username, filters.user) : undefined,
    filters.result ? inArray(loginAttempts.outcome, [...RESULT_OUTCOMES[filters.result]]) : undefined,
  );
}

export async function listAccessLog(
  filters: AccessLogFilters,
  window: { offset: number; limit: number },
  now = new Date(),
): Promise<AccessLogRow[]> {
  return (
    db
      // The join, not the row's `user_id`: refused and emergency-unlock rows of
      // a real user carry no `user_id`. Only the matched user's name is read.
      .select({
        id: loginAttempts.id,
        at: loginAttempts.at,
        username: users.username,
        ip: loginAttempts.ip,
        outcome: loginAttempts.outcome,
      })
      .from(loginAttempts)
      .leftJoin(users, eq(users.username, loginAttempts.username))
      .where(matching(filters, now))
      .orderBy(desc(loginAttempts.at), desc(loginAttempts.id))
      .limit(window.limit)
      .offset(window.offset)
  );
}

export async function countAccessLog(filters: AccessLogFilters, now = new Date()): Promise<number> {
  const [row] = await db.select({ n: count() }).from(loginAttempts).where(matching(filters, now));
  return row.n;
}
