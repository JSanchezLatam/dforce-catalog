import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, validateSession } from "@/modules/auth/session";

/**
 * Blanket route guard (NFR-5) — every route except /login (page + its own
 * /api/login POST target) requires a valid session. Proxy (renamed from
 * "middleware" in Next.js 16, see
 * node_modules/next/.../file-conventions/proxy.md) always runs the Node.js
 * runtime, which session validation needs since it's a Postgres query via
 * `pg`/Drizzle — the `runtime` config key is not settable here and would
 * throw if we tried.
 */
export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};

/** Same denial shape for both "no token" and "invalid session" branches (page redirect vs API 401) — kept as one function so the two branches cannot drift apart again (that drift was the original bug: only the no-token branch checked `isApiRoute`). */
function denyAccess(request: NextRequest, isApiRoute: boolean): NextResponse {
  if (isApiRoute) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

/**
 * `handleProxy()`/`proxy()` split (mirrors `handleLogout()`/`POST()` in
 * `api/logout/route.ts`) — `proxy` is the exact signature Next.js' file
 * convention invokes, so the injectable `validateSession` dep lives on the
 * inner function `proxy.test.ts` calls directly.
 */
export async function handleProxy(
  request: NextRequest,
  deps: { validateSession?: typeof validateSession } = {},
): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  // No cookie at all -> 401 before any DB query executes (NFR-5) for API
  // consumers (fetch/JS expects JSON); page navigations get sent to /login
  // instead, since a raw 401 JSON body is not a usable response for a
  // browser tab (this was the actual bug: every fresh visitor to "/" saw
  // JSON, not a login screen).
  if (!token) {
    return denyAccess(request, isApiRoute);
  }

  const validate = deps.validateSession ?? validateSession;
  const user = await validate(token);

  // Invalid/expired/revoked token, OR a deactivated user's otherwise-valid
  // session (design.md Decision 7 — validateSession() already returns null
  // for that case too) -> same denial as the no-token branch above: page
  // navigations go to /login (R9.3), API routes get 401 JSON. This used to
  // always redirect regardless of isApiRoute — the bug the spec's "401 JSON
  // for API" requirement depends on fixing.
  if (!user) {
    return denyAccess(request, isApiRoute);
  }

  // Forward the resolved identity so route handlers can call can(requireSession(req), action)
  // without re-querying the DB (design.md: "Route handlers call requireSession() then can()").
  const headers = new Headers(request.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-user-role", user.role);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  return handleProxy(request);
}
