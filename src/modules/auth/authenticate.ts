import { eq } from "drizzle-orm";

import { verifyPassword } from "@/modules/auth/password";
import { isUserActive, issueSession, type Role } from "@/modules/auth/session";
import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";

export type AuthResult =
  | { ok: true; token: string; expiresAt: Date; role: Role }
  | { ok: false };

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

  const user = await findUser(username);
  if (!user || !(await doVerifyPassword(password, user.passwordHash)) || !isUserActive(user)) {
    return { ok: false };
  }

  const { token, expiresAt } = await doIssueSession(user.id);
  return { ok: true, token, expiresAt, role: user.role };
}
