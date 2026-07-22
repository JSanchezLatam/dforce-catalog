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

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  // No cookie at all -> 401 before any DB query executes (NFR-5) for API
  // consumers (fetch/JS expects JSON); page navigations get sent to /login
  // instead, since a raw 401 JSON body is not a usable response for a
  // browser tab (this was the actual bug: every fresh visitor to "/" saw
  // JSON, not a login screen).
  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const user = await validateSession(token);

  // Invalid/expired/revoked token -> send the browser back to login (R9.3).
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Forward the resolved identity so route handlers can call can(requireSession(req), action)
  // without re-querying the DB (design.md: "Route handlers call requireSession() then can()").
  const headers = new Headers(request.headers);
  headers.set("x-user-id", user.id);
  headers.set("x-user-role", user.role);
  return NextResponse.next({ request: { headers } });
}
