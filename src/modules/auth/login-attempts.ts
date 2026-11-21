import { randomUUID } from "node:crypto";

import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { loginAttempts } from "@/shared/db/schema";

import { IP_LOCK, lockedUntil, loginKey, LOOKBACK_MS, USER_LOCK, type LoginOutcome } from "./login-lock";

/**
 * A login's counted rows reach back to its last success or unlock, not a fixed
 * window: the escalation (S6) needs every lock since, however old.
 */
const sinceLastReset = sql`${loginAttempts.at} >= coalesce(
  (select max(r.at) from login_attempts r
   where r.username = ${loginAttempts.username} and r.outcome in ('success', 'unlocked')),
  '-infinity')`;

export type ReservedAttempt = { attemptId: string } | { lockedUntil: Date };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The per-login then per-IP advisory locks every attempt and unlock takes, in this order. */
export async function takeLoginLocks(tx: Tx, input: { username: string; ip: string | null }): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`login-user:${input.username}`}))`);
  if (input.ip) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`login-ip:${input.ip}`}))`);
}

/** The end of the user or IP lock holding now, whichever lasts longer; call it under `takeLoginLocks`. */
export async function currentLock(
  tx: Tx,
  input: { username: string; ip: string | null },
  now: Date,
): Promise<Date | undefined> {
  const since = new Date(now.getTime() - LOOKBACK_MS);
  // Refused attempts never count toward a lock, so these reads leave them out.
  const counted = ne(loginAttempts.outcome, "locked");
  const columns = { at: loginAttempts.at, outcome: loginAttempts.outcome };
  const byUser = await tx
    .select(columns)
    .from(loginAttempts)
    .where(and(eq(loginAttempts.username, input.username), counted, sinceLastReset));
  const byIp = input.ip
    ? await tx
        .select(columns)
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ip, input.ip), counted, gt(loginAttempts.at, since)))
    : [];

  const locks = [lockedUntil(byUser, now, USER_LOCK), lockedUntil(byIp, now, IP_LOCK)].filter(
    (until): until is Date => until !== null,
  );
  return locks.sort((a, b) => b.getTime() - a.getTime())[0];
}

/**
 * Counts this attempt as a failure BEFORE the password is compared, under
 * per-login and per-IP advisory locks, so parallel guesses cannot all pass the
 * check. A correct password later turns the row into a success.
 */
export async function reserveLoginAttempt(input: { username: string; ip: string | null }): Promise<ReservedAttempt> {
  const now = new Date();

  return db.transaction(async (tx) => {
    await takeLoginLocks(tx, input);
    const until = await currentLock(tx, input, now);
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
  secondFactor?: "trusted_device",
): Promise<void> {
  await db.update(loginAttempts).set({ outcome, userId, secondFactor }).where(eq(loginAttempts.id, attemptId));
}

/**
 * An administrator's unlock: an `unlocked` row resets the user counter, so the
 * next attempt is judged as if the earlier failures never happened. It takes
 * the same per-login lock as an attempt, so it cannot interleave with one.
 * The IP lock is untouched: an address guessing across logins stays locked.
 */
export async function unlockLogin(input: {
  userId: string;
  username: string;
  ip: string | null;
  actorId: string;
}): Promise<void> {
  const username = loginKey(input.username);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`login-user:${username}`}))`);
    await tx.insert(loginAttempts).values({
      id: randomUUID(),
      at: new Date(),
      username,
      userId: input.userId,
      ip: input.ip,
      outcome: "unlocked",
      actorId: input.actorId,
    });
  });
}

export const RETENTION_DAYS = 90;

/**
 * S10 retention: deletes attempts older than 90 days that no lock reads any
 * more. That means refused attempts, which no lock counts, and rows strictly
 * before a later success or unlock of the same login (`sinceLastReset` starts
 * there). The IP lock reads only minutes back. A standing lock on a real user
 * therefore keeps every row it is computed from, however old, and the result
 * cannot change under a concurrent attempt: the last reset only moves forward.
 *
 * A login that matches no user loses its old rows even while locked. The owner
 * chose this on 2026-11-20 ("Borrarlos a los 90 días"), because the typed text
 * may be a password. The cost is a slow oracle: a name locked until unlock
 * opens again after 90 days only if no such user exists.
 */
export async function purgeOldLoginAttempts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(loginAttempts)
    .where(
      and(
        lt(loginAttempts.at, cutoff),
        sql`(${loginAttempts.outcome} = 'locked'
          or not exists (select 1 from users u where u.username = ${loginAttempts.username})
          or exists (
            select 1 from login_attempts s
            where s.username = ${loginAttempts.username}
              and s.outcome in ('success', 'unlocked')
              and s.at > ${loginAttempts.at}))`,
      ),
    )
    .returning({ id: loginAttempts.id });
  return deleted.length;
}

/** The logins among `usernames` locked right now, with the end of each lock. */
export async function userLocks(usernames: readonly string[]): Promise<Map<string, Date>> {
  const now = new Date();
  const keys = usernames.map(loginKey);
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({ username: loginAttempts.username, at: loginAttempts.at, outcome: loginAttempts.outcome })
    .from(loginAttempts)
    .where(
      and(
        inArray(loginAttempts.username, keys),
        ne(loginAttempts.outcome, "locked"),
        sinceLastReset,
      ),
    );

  const locks = new Map<string, Date>();
  for (const username of usernames) {
    const until = lockedUntil(rows.filter((row) => row.username === loginKey(username)), now, USER_LOCK);
    if (until) locks.set(username, until);
  }
  return locks;
}
