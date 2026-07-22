import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { verifyPassword } from "@/modules/auth/password";
import { issueSession, SESSION_COOKIE } from "@/modules/auth/session";
import { db } from "@/shared/db/client";
import { users } from "@/shared/db/schema";

/**
 * R9.1/9.2 — login. `proxy.ts` already excludes `/login`/`/api/login` from
 * its blanket guard (see its `matcher`), so this is the one route allowed to
 * run before any session exists.
 *
 * Generic error on ANY failure (unknown username OR wrong password) — same
 * response either way so no user-enumeration signal leaks (R9.2's explicit
 * scenario). `SESSION_COOKIE` is `auth/session.ts`'s single source of truth
 * (the same name `proxy.ts` reads back).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const invalid = () => NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (!username || !password) return invalid();

  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return invalid();
  }

  const { token, expiresAt } = await issueSession(user.id);
  const response = NextResponse.json({ ok: true, role: user.role });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return response;
}
