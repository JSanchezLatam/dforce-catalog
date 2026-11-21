import { and, eq, isNotNull } from "drizzle-orm";

import { requiresTwoFactor } from "@/modules/auth/enrolment";
import { reserveLoginAttempt, settleLoginAttempt } from "@/modules/auth/login-attempts";
import { loginKey } from "@/modules/auth/login-lock";
import { verifyPassword } from "@/modules/auth/password";
import { isUserActive, issueSession, type Role } from "@/modules/auth/session";
import { isTrustedDevice } from "@/modules/auth/trusted-device";
import { db } from "@/shared/db/client";
import { users, userTotp } from "@/shared/db/schema";

export type AuthResult =
  | { ok: true; token: string; expiresAt: Date; role: Role; pending?: "verify" | "enroll" }
  | { ok: false; lockedUntil?: Date };

/** Compared when the user does not exist, so that case costs the same bcrypt time. Matches no password in use. */
const UNKNOWN_USER_HASH = "$2b$12$dILTUHrTcECh6CwTX1X11eLppcwSd2W9GHXDcAFpMij2ltg.GtwlW";

type AuthenticateUserRow = {
  id: string;
  passwordHash: string;
  role: Role;
  deactivatedAt: Date | null;
};

export type AuthenticateUserDeps = {
  findUser?: (username: string) => Promise<AuthenticateUserRow | undefined>;
  verifyPassword?: typeof verifyPassword;
  issueSession?: typeof issueSession;
  /** Whether the user finished enrolling (`enabled_at` set); a row mid-enrolment does not count. */
  hasTwoFactor?: (userId: string) => Promise<boolean>;
  attempts?: { reserve: typeof reserveLoginAttempt; settle: typeof settleLoginAttempt };
  ip?: string | null;
  /** The `trusted_device` cookie's value, if the browser sent one (T9). */
  trustedDeviceToken?: string | null;
  isTrustedDevice?: typeof isTrustedDevice;
};

async function findUserDefault(username: string): Promise<AuthenticateUserRow | undefined> {
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      role: users.role,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0];
}

async function hasTwoFactorDefault(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: userTotp.userId })
    .from(userTotp)
    .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Shared credential-check + session-issue logic (R9.1/9.2), used by both the
 * `/api/login` Route Handler (kept alive for `src/e2e/full-flow.e2e.test.ts`,
 * which calls it directly as a real NextRequest/NextResponse handler) and the
 * `loginAction` Server Action `LoginForm.tsx` drives via `useActionState`.
 * Generic failure for ANY reason (unknown username, wrong password, OR a
 * deactivated account — design.md Decision 7) — same result either way so no
 * enumeration signal leaks (R9.2). This is the login-path half of
 * deactivation enforcement: without it, revoking a deactivated user's
 * existing sessions does nothing about a brand-new login.
 *
 * `deps` is an injectable seam (mirrors `modules/account/service.ts`'s style)
 * so this is testable without a live Postgres connection.
 */
export async function authenticateUser(
  username: string,
  password: string,
  deps: AuthenticateUserDeps = {},
): Promise<AuthResult> {
  if (!username || !password) return { ok: false };

  const findUser = deps.findUser ?? findUserDefault;
  const doVerifyPassword = deps.verifyPassword ?? verifyPassword;
  const doIssueSession = deps.issueSession ?? issueSession;
  const hasTwoFactor = deps.hasTwoFactor ?? hasTwoFactorDefault;
  const attempts = deps.attempts ?? { reserve: reserveLoginAttempt, settle: settleLoginAttempt };

  const reserved = await attempts.reserve({ username: loginKey(username), ip: deps.ip ?? null });
  if ("lockedUntil" in reserved) return { ok: false, lockedUntil: reserved.lockedUntil };

  const user = await findUser(username);
  const passwordMatches = await doVerifyPassword(password, user?.passwordHash ?? UNKNOWN_USER_HASH);

  if (!user) {
    await attempts.settle(reserved.attemptId, "unknown_user", null);
    return { ok: false };
  }
  if (!passwordMatches || !isUserActive(user)) {
    await attempts.settle(reserved.attemptId, passwordMatches ? "inactive" : "bad_password", user.id);
    return { ok: false };
  }

  // The password alone is not a success: a success resets the lock counter, and
  // the code step must keep counting toward it (L28).
  if (await hasTwoFactor(user.id)) {
    // S3: a device this same user trusted, still unexpired, stands in for the code.
    if (deps.trustedDeviceToken && (await (deps.isTrustedDevice ?? isTrustedDevice)(user.id, deps.trustedDeviceToken))) {
      const { token, expiresAt } = await doIssueSession(user.id, user.role);
      await attempts.settle(reserved.attemptId, "success", user.id, "trusted_device");
      return { ok: true, token, expiresAt, role: user.role };
    }
    const { token, expiresAt } = await doIssueSession(user.id, user.role, { pending: "verify" });
    await attempts.settle(reserved.attemptId, "password_ok", user.id);
    return { ok: true, token, expiresAt, role: user.role, pending: "verify" };
  }

  // S2: a mandatory role without 2FA must set it up before anything else (L41). The
  // password is the whole login here, as no second factor exists yet, so it is a success.
  if (requiresTwoFactor(user.role)) {
    const { token, expiresAt } = await doIssueSession(user.id, user.role, { pending: "enroll" });
    await attempts.settle(reserved.attemptId, "success", user.id);
    return { ok: true, token, expiresAt, role: user.role, pending: "enroll" };
  }

  const { token, expiresAt } = await doIssueSession(user.id, user.role);
  await attempts.settle(reserved.attemptId, "success", user.id);
  return { ok: true, token, expiresAt, role: user.role };
}
