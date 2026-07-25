import { eq } from "drizzle-orm";

import { verifyPassword } from "@/modules/auth/password";
import { issueSession, type Role } from "@/modules/auth/session";
import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";

export type AuthResult =
  | { ok: true; token: string; expiresAt: Date; role: Role }
  | { ok: false };

/**
 * Shared credential-check + session-issue logic (R9.1/9.2), used by both the
 * `/api/login` Route Handler (kept alive for `src/e2e/full-flow.e2e.test.ts`,
 * which calls it directly as a real NextRequest/NextResponse handler) and the
 * `loginAction` Server Action `LoginForm.tsx` drives via `useActionState`.
 * Generic failure for ANY reason (unknown username OR wrong password) — same
 * result either way so no user-enumeration signal leaks (R9.2).
 */
export async function authenticateUser(username: string, password: string): Promise<AuthResult> {
  if (!username || !password) return { ok: false };

  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false };
  }

  const { token, expiresAt } = await issueSession(user.id);
  return { ok: true, token, expiresAt, role: user.role };
}
