import { randomUUID } from "node:crypto";

import { and, desc, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";

import { currentLock, takeLoginLocks } from "./login-attempts";
import { loginKey } from "./login-lock";
import { matchRecoveryCode } from "./recovery-codes";
import { openSecret, totpKey } from "./secret-box";
import { isSessionActive, isUserActive, issueSession, type Role, type SessionPending } from "./session";
import { verifyTotp } from "./totp";
import { trustDevice } from "./trusted-device";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SecondFactorResult =
  | { ok: true; token: string; expiresAt: Date; role: Role; trustedDevice?: { token: string; expiresAt: Date } }
  | { ok: false; reason?: "no_pending_session" | "unavailable"; lockedUntil?: Date };

export type SecondFactorDeps = {
  key?: () => Buffer;
  transaction?: typeof db.transaction;
  issueSession?: typeof issueSession;
};

export type SecondFactorSession = {
  userId: string;
  username: string;
  role: Role;
  pending: SessionPending | null;
  createdAt: Date;
};

/** The session behind `token` with its user, or null when it is not usable at all. */
export async function secondFactorSession(
  token: string,
  executor: Pick<Tx, "select"> = db,
): Promise<SecondFactorSession | null> {
  const [row] = await executor
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
      pending: sessions.pending,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);
  if (!row || !isSessionActive(row) || !isUserActive(row)) return null;
  return { userId: row.userId, username: row.username, role: row.role, pending: row.pending, createdAt: row.createdAt };
}

type Passed = { secondFactor: "totp" | "recovery" };

/** Compares and consumes the code; single use is the row count of a guarded UPDATE, not the read before it. */
async function consume(
  tx: Tx,
  input: { userId: string; code?: string; recoveryCode?: string },
  key: Buffer,
  now: Date,
): Promise<Passed | "wrong" | "unavailable" | "gone"> {
  const [totp] = await tx
    .select({ secretSealed: userTotp.secretSealed, lastStep: userTotp.lastStep })
    .from(userTotp)
    .where(and(eq(userTotp.userId, input.userId), isNotNull(userTotp.enabledAt)));
  // 2FA reset between the password and the code: no code can pass, so it is not a guess.
  if (!totp) return "gone";
  // Checked for both paths: a key that no longer opens the secret is an install
  // problem, not a guess, and it must not lock anyone. A recovery code alone
  // cannot tell, because a wrong key and a wrong code both just fail to match.
  let secret: string;
  try {
    secret = openSecret(totp.secretSealed, input.userId, key);
  } catch (error) {
    console.error("2FA unavailable:", error instanceof Error ? error.message : "secret cannot be opened");
    return "unavailable";
  }

  if (input.recoveryCode !== undefined) {
    const unused = await tx
      .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, input.userId), isNull(recoveryCodes.usedAt)));
    const index = matchRecoveryCode(input.recoveryCode, unused.map((row) => row.codeHash), key);
    if (index === null) return "wrong";
    const used = await tx
      .update(recoveryCodes)
      .set({ usedAt: now })
      .where(and(eq(recoveryCodes.id, unused[index].id), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return used.length === 1 ? { secondFactor: "recovery" } : "wrong";
  }

  const step = verifyTotp(secret, input.code ?? "", now, totp.lastStep ?? undefined);
  if (step === null) return "wrong";
  const stored = await tx
    .update(userTotp)
    .set({ lastStep: step })
    .where(and(eq(userTotp.userId, input.userId), or(isNull(userTotp.lastStep), lt(userTotp.lastStep, step))))
    .returning({ userId: userTotp.userId });
  return stored.length === 1 ? { secondFactor: "totp" } : "wrong";
}

/**
 * The second step of a 2FA login (L28, L29, L33). One transaction under the
 * same advisory locks as `reserveLoginAttempt`: it refuses while the user or IP
 * lock holds, a wrong code counts as `bad_code`, and a right one turns this
 * session's `password_ok` row into a success stamped now, so the bad codes
 * before it fall behind the reset. The full session is issued after commit.
 */
export async function verifySecondFactor(
  input: { token: string; code?: string; recoveryCode?: string; ip: string | null; trustDevice?: boolean },
  deps: SecondFactorDeps = {},
): Promise<SecondFactorResult> {
  let key: Buffer;
  try {
    key = (deps.key ?? totpKey)();
  } catch (error) {
    // The message names the problem (missing or wrong length), never the key.
    console.error("2FA unavailable:", error instanceof Error ? error.message : "key cannot be read");
    return { ok: false, reason: "unavailable" };
  }
  const transaction = deps.transaction ?? db.transaction.bind(db);

  const outcome = await transaction(async (tx) => {
    const found = await secondFactorSession(input.token, tx);
    if (!found || found.pending !== "verify") return { ok: false as const, reason: "no_pending_session" as const };
    const username = loginKey(found.username);
    await takeLoginLocks(tx, { username, ip: input.ip });

    // Read again under the lock: a parallel request on this session may have just finished it.
    const session = await secondFactorSession(input.token, tx);
    if (!session || session.pending !== "verify") return { ok: false as const, reason: "no_pending_session" as const };
    // After the locks, not before: a row committed while this request waited must come earlier than its stamp.
    const now = new Date();
    const lockedUntil = await currentLock(tx, { username, ip: input.ip }, now);
    if (lockedUntil) return { ok: false as const, lockedUntil };

    const passed = await consume(tx, { ...input, userId: session.userId }, key, now);
    if (passed === "unavailable") return { ok: false as const, reason: "unavailable" as const };
    if (passed === "gone") {
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, input.token));
      return { ok: false as const, reason: "no_pending_session" as const };
    }
    if (passed === "wrong") {
      await tx.insert(loginAttempts).values({
        id: randomUUID(),
        at: now,
        username,
        userId: session.userId,
        ip: input.ip,
        outcome: "bad_code",
      });
      return { ok: false as const };
    }

    const [passwordOk] = await tx
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.userId, session.userId),
          eq(loginAttempts.outcome, "password_ok"),
          lte(loginAttempts.at, session.createdAt),
        ),
      )
      .orderBy(desc(loginAttempts.at))
      .limit(1);
    if (passwordOk) {
      await tx
        .update(loginAttempts)
        .set({ outcome: "success", at: now, secondFactor: passed.secondFactor })
        .where(eq(loginAttempts.id, passwordOk.id));
    }
    await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, input.token));
    // S3: stored with the success it rides on, so a rolled-back code never leaves a device behind.
    const trustedDevice = input.trustDevice === true ? await trustDevice(session.userId, tx, now) : undefined;
    return { ok: true as const, userId: session.userId, role: session.role, trustedDevice };
  });

  if (!outcome.ok) return outcome;
  const { token, expiresAt } = await (deps.issueSession ?? issueSession)(outcome.userId, outcome.role);
  return outcome.trustedDevice
    ? { ok: true, token, expiresAt, role: outcome.role, trustedDevice: outcome.trustedDevice }
    : { ok: true, token, expiresAt, role: outcome.role };
}
