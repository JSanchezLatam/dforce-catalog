import { NextResponse, type NextRequest } from "next/server";

import { revokeSession, SESSION_COOKIE } from "@/modules/auth/session";

/**
 * Logout. No `requireSession()` here: a missing/expired cookie should still
 * clear cleanly (200 + expired cookie) instead of erroring, same defensive
 * stance as login's generic-failure response — the client always ends up on
 * `/login` either way. Exported separately from `POST` (a `deps` param would
 * fail Next's own route-handler type check at build time — `RouteHandlerConfig`
 * requires the exact `(request, { params })` signature, same split as
 * `inventory-sync/manual/route.ts`) so route.test.ts can still inject a fake.
 */
export async function handleLogout(
  request: NextRequest,
  deps: { revokeSession?: typeof revokeSession } = {},
): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await (deps.revokeSession ?? revokeSession)(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  });
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleLogout(request);
}
