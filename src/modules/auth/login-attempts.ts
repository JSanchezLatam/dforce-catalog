import { randomUUID } from "node:crypto";

import { and, eq, gt, ne, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { loginAttempts } from "@/shared/db/schema";

import { IP_LOCK, lockedUntil, LOOKBACK_MS, USER_LOCK, type LoginOutcome } from "./login-lock";

export type ReservedAttempt = { attemptId: string } | { lockedUntil: Date };

/**
 * Counts this attempt as a failure BEFORE the password is compared, under
 * per-login and per-IP advisory locks, so parallel guesses cannot all pass the
 * check. A correct password later turns the row into a success.
 */
export async function reserveLoginAttempt(input: { username: string; ip: string | null }): Promise<ReservedAttempt> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`login-user:${input.username}`}))`);
    if (input.ip) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`login-ip:${input.ip}`}))`);

    // Refused attempts never count, and skipping them keeps a hammered login cheap to check.
    const counted = and(gt(loginAttempts.at, since), ne(loginAttempts.outcome, "locked"));
    const columns = { at: loginAttempts.at, outcome: loginAttempts.outcome };
    const byUser = await tx
      .select(columns)
      .from(loginAttempts)
      .where(and(eq(loginAttempts.username, input.username), counted));
    const byIp = input.ip
      ? await tx
          .select(columns)
          .from(loginAttempts)
          .where(and(eq(loginAttempts.ip, input.ip), counted))
      : [];

    const locks = [lockedUntil(byUser, now, USER_LOCK), lockedUntil(byIp, now, IP_LOCK)].filter(
      (until): until is Date => until !== null,
    );
    const until = locks.sort((a, b) => b.getTime() - a.getTime())[0];
    const attemptId = randomUUID();

    await tx.insert(loginAttempts).values({
      id: attemptId,
      at: now,
      username: input.username,
      ip: input.ip,
      outcome: until ? "locked" : "bad_password",
    });

    return until ? { lockedUntil: until } : { attemptId };
  });
}

export async function settleLoginAttempt(
  attemptId: string,
  outcome: LoginOutcome,
  userId: string | null,
): Promise<void> {
  await db.update(loginAttempts).set({ outcome, userId }).where(eq(loginAttempts.id, attemptId));
}
