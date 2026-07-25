import { NextResponse, type NextRequest } from "next/server";

import { authenticateUser } from "@/modules/auth/authenticate";
import { SESSION_COOKIE } from "@/modules/auth/session";

/**
 * R9.1/9.2 — login. `proxy.ts` already excludes `/login`/`/api/login` from
 * its blanket guard (see its `matcher`), so this is the one route allowed to
 * run before any session exists.
 *
 * Kept as a real Route Handler (not folded entirely into the `loginAction`
 * Server Action in `modules/auth/actions.ts`) because
 * `src/e2e/full-flow.e2e.test.ts` calls this `POST` export directly with a
 * hand-built `NextRequest` and asserts on the returned `NextResponse`
 * (status/cookies) — the same pattern used for every other route handler in
 * that suite. Credential check + session issuance now live once in
 * `authenticateUser()`; this handler and `loginAction` both call it instead
 * of duplicating the DB/bcrypt logic.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const result = await authenticateUser(username, password);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role: result.role });
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    expires: result.expiresAt,
    path: "/",
  });
  return response;
}
