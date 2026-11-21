import { randomUUID } from "node:crypto";

import { and, count, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import QRCode from "qrcode";

import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, users, userTotp } from "@/shared/db/schema";

import { currentLock, takeLoginLocks } from "./login-attempts";
import { loginKey } from "./login-lock";
import { verifyPassword } from "./password";
import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes";
import type { Role } from "./roles";
import { openSecret, sealSecret, totpKey } from "./secret-box";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

/**
 * 2FA enrolment from Mi cuenta (T8a, L37): start, confirm, regenerate the
 * recovery codes, disable. Every operation takes the user id from the session.
 * Start asks for the current password, so a stolen session cannot enrol its own
 * secret; a wrong one is not counted, like the password change. Re-authentication
 * (regenerate, disable) runs under the login advisory locks and counts a wrong
 * code as `bad_code`, so a stolen session gets no more guesses at the app code
 * than a login does (S6); confirm needs no lock, as the secret is new.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** S2: 2FA is mandatory for these roles, so they cannot disable it. */
const REQUIRED_FOR: readonly Role[] = ["administrador", "jefe_taller"];
export const requiresTwoFactor = (role: Role): boolean => REQUIRED_FOR.includes(role);

/** The `otpauth` issuer when the workshop has no name configured. */
export const DEFAULT_ISSUER = "DForce";

export type EnrolmentFailure = {
  ok: false;
  reason:
    | "unavailable"
    | "invalid_password"
    | "invalid_code"
    | "code_used"
    | "locked"
    | "already_enabled"
    | "not_enrolling"
    | "not_enabled"
    | "required_for_role";
};

export type EnrolmentDeps = {
  key?: () => Buffer;
  transaction?: typeof db.transaction;
  now?: () => Date;
};

const fail = (reason: EnrolmentFailure["reason"]): EnrolmentFailure => ({ ok: false, reason });
const SIX_DIGITS = /^\d{6}$/;

/** Null when the key is missing or malformed; the log names the problem, never the key. */
function readKey(deps: EnrolmentDeps): Buffer | null {
  try {
    return (deps.key ?? totpKey)();
  } catch (error) {
    console.error("2FA unavailable:", error instanceof Error ? error.message : "key cannot be read");
    return null;
  }
}

/** A secret the key no longer opens is an install problem (T7's B1), never a wrong code. */
function open(sealed: string, userId: string, key: Buffer): string | null {
  try {
    return openSecret(sealed, userId, key);
  } catch (error) {
    console.error("2FA unavailable:", error instanceof Error ? error.message : "secret cannot be opened");
    return null;
  }
}

/** Needs no key, so Mi cuenta renders on an install that has none. */
export async function twoFactorStatus(
  userId: string,
): Promise<{ enabled: boolean; enabledAt: Date | null; codesLeft: number }> {
  const [row] = await db
    .select({ enabledAt: userTotp.enabledAt })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)));
  if (!row) return { enabled: false, enabledAt: null, codesLeft: 0 };
  const [left] = await db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return { enabled: true, enabledAt: row.enabledAt, codesLeft: left?.n ?? 0 };
}

/** Deletes every old code, so a regenerate replaces them instead of adding ten more. */
async function replaceRecoveryCodes(tx: Tx, userId: string, key: Buffer): Promise<string[]> {
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  const codes = generateRecoveryCodes();
  await tx
    .insert(recoveryCodes)
    .values(codes.map((code) => ({ id: randomUUID(), userId, codeHash: hashRecoveryCode(code, key) })));
  return codes;
}

/**
 * Re-authentication for regenerate and disable: a current app code, single use
 * through the same guarded `last_step` UPDATE as the login's second step.
 */
async function reauthenticate(
  tx: Tx,
  userId: string,
  code: string,
  key: Buffer,
  now: Date,
): Promise<EnrolmentFailure | null> {
  const [user] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
  if (!user) return fail("not_enabled");
  const username = loginKey(user.username);
  await takeLoginLocks(tx, { username, ip: null });
  if (await currentLock(tx, { username, ip: null }, now)) return fail("locked");
  const wrong = async () => {
    await tx.insert(loginAttempts).values({ id: randomUUID(), at: now, username, userId, ip: null, outcome: "bad_code" });
    return fail("invalid_code");
  };

  const [row] = await tx
    .select({ secretSealed: userTotp.secretSealed, lastStep: userTotp.lastStep })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)));
  if (!row) return fail("not_enabled");
  const secret = open(row.secretSealed, userId, key);
  if (secret === null) return fail("unavailable");
  const step = verifyTotp(secret, code, now, row.lastStep ?? undefined);
  if (step === null) {
    // The user's own code, already spent at a step `last_step` covers: not a guess, so no `bad_code`.
    const spent = verifyTotp(secret, code, now);
    return spent !== null && row.lastStep !== null && spent <= row.lastStep ? fail("code_used") : wrong();
  }
  const stored = await tx
    .update(userTotp)
    .set({ lastStep: step })
    .where(and(eq(userTotp.userId, userId), or(isNull(userTotp.lastStep), lt(userTotp.lastStep, step))))
    .returning({ userId: userTotp.userId });
  return stored.length === 1 ? null : wrong();
}

type Started = { ok: true; secret: string; otpauthUri: string; qrDataUrl: string };

/**
 * Writes a fresh sealed secret with `enabled_at` null, replacing any unfinished
 * one. The upsert's `setWhere` is the refusal once enabled, so a race with a
 * confirm can never swap an enabled secret. `password` is null only for the
 * mandatory setup (T8b), whose enroll session comes from a password typed at
 * most 30 minutes earlier (L41); everything else is the same code.
 */
async function beginEnrolment(
  userId: string,
  password: string | null,
  issuer: string,
  deps: EnrolmentDeps,
): Promise<Started | EnrolmentFailure> {
  const key = readKey(deps);
  if (!key) return fail("unavailable");
  const transaction = deps.transaction ?? db.transaction.bind(db);
  const now = (deps.now ?? (() => new Date()))();
  const secret = generateTotpSecret();
  const secretSealed = sealSecret(secret, userId, key);

  const started = await transaction(async (tx) => {
    const [user] = await tx
      .select({ username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return fail("invalid_password");
    if (password !== null && !(await verifyPassword(password, user.passwordHash))) return fail("invalid_password");
    const written = await tx
      .insert(userTotp)
      .values({ userId, secretSealed, enabledAt: null, lastStep: null, createdAt: now })
      .onConflictDoUpdate({
        target: userTotp.userId,
        set: { secretSealed, lastStep: null, createdAt: now },
        setWhere: isNull(userTotp.enabledAt),
      })
      .returning({ userId: userTotp.userId });
    return written.length === 1 ? { username: user.username } : fail("already_enabled");
  });
  if ("ok" in started) return started;

  const uri = otpauthUri({ secret, issuer, account: started.username });
  // Black on white with a quiet zone whatever the theme, or phones fail to scan it on the dark ground.
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 2, width: 240 });
  return { ok: true, secret: secret.match(/.{1,4}/g)!.join(" "), otpauthUri: uri, qrDataUrl };
}

/** "Activar" in Mi cuenta: the current password first, so a stolen session cannot enrol its own secret. */
export async function startEnrolment(
  userId: string,
  password: string,
  issuer: string,
  deps: EnrolmentDeps = {},
): Promise<Started | EnrolmentFailure> {
  if (!password) return fail("invalid_password");
  return beginEnrolment(userId, password, issuer, deps);
}

/** The mandatory setup's start (T8b). Callers must have checked the session is a database-read `enroll` one. */
export async function startRequiredEnrolment(
  userId: string,
  issuer: string,
  deps: EnrolmentDeps = {},
): Promise<Started | EnrolmentFailure> {
  return beginEnrolment(userId, null, issuer, deps);
}

/** Whether the key reads, so a screen can say 2FA is unavailable before anyone types a code. */
export function twoFactorAvailable(deps: Pick<EnrolmentDeps, "key"> = {}): boolean {
  return readKey(deps) !== null;
}

/** Verifies the code against the unfinished secret, enables 2FA and returns the 10 codes, the only time they are shown. */
export async function confirmEnrolment(
  userId: string,
  code: string,
  deps: EnrolmentDeps = {},
): Promise<{ ok: true; codes: string[] } | EnrolmentFailure> {
  if (!SIX_DIGITS.test(code)) return fail("invalid_code");
  const key = readKey(deps);
  if (!key) return fail("unavailable");
  const transaction = deps.transaction ?? db.transaction.bind(db);
  const now = (deps.now ?? (() => new Date()))();

  return transaction(async (tx) => {
    const [row] = await tx
      .select({ secretSealed: userTotp.secretSealed })
      .from(userTotp)
      .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt)));
    if (!row) return fail("not_enrolling");
    const secret = open(row.secretSealed, userId, key);
    if (secret === null) return fail("unavailable");
    const step = verifyTotp(secret, code, now);
    if (step === null) return fail("invalid_code");
    // Guarded on the secret just checked: a restart in between must not be enabled by the old code.
    const enabled = await tx
      .update(userTotp)
      .set({ enabledAt: now, lastStep: step })
      .where(and(eq(userTotp.userId, userId), isNull(userTotp.enabledAt), eq(userTotp.secretSealed, row.secretSealed)))
      .returning({ userId: userTotp.userId });
    if (enabled.length !== 1) return fail("not_enrolling");
    return { ok: true as const, codes: await replaceRecoveryCodes(tx, userId, key) };
  });
}

/** Needs a current app code; the 10 old codes are deleted and the new ones returned once. */
export async function regenerateRecoveryCodes(
  userId: string,
  code: string,
  deps: EnrolmentDeps = {},
): Promise<{ ok: true; codes: string[] } | EnrolmentFailure> {
  if (!SIX_DIGITS.test(code)) return fail("invalid_code");
  const key = readKey(deps);
  if (!key) return fail("unavailable");
  const transaction = deps.transaction ?? db.transaction.bind(db);
  const now = (deps.now ?? (() => new Date()))();

  return transaction(async (tx) => {
    const refused = await reauthenticate(tx, userId, code, key, now);
    if (refused) return refused;
    return { ok: true as const, codes: await replaceRecoveryCodes(tx, userId, key) };
  });
}

/**
 * Needs a current app code and a role 2FA is optional for (S2). Removes the
 * secret and the codes and revokes every session but `currentToken`, in one
 * transaction: 2FA is never off with the other sessions still open.
 */
export async function disableTwoFactor(
  userId: string,
  role: Role,
  code: string,
  currentToken: string,
  deps: EnrolmentDeps = {},
): Promise<{ ok: true } | EnrolmentFailure> {
  if (requiresTwoFactor(role)) return fail("required_for_role");
  if (!SIX_DIGITS.test(code)) return fail("invalid_code");
  const key = readKey(deps);
  if (!key) return fail("unavailable");
  const transaction = deps.transaction ?? db.transaction.bind(db);
  const now = (deps.now ?? (() => new Date()))();

  const refused = await transaction(async (tx) => {
    const failure = await reauthenticate(tx, userId, code, key, now);
    if (failure) return failure;
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.delete(userTotp).where(eq(userTotp.userId, userId));
    // revokeOtherSessions' predicate, on `tx`: that helper writes through `db`, outside this transaction.
    await tx.execute(
      sql`UPDATE sessions SET revoked_at = ${now} WHERE user_id = ${userId} AND revoked_at IS NULL AND id <> ${currentToken}`,
    );
    return null;
  });
  return refused ?? { ok: true };
}
