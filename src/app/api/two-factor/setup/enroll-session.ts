import { NextResponse, type NextRequest } from "next/server";

import { secondFactorSession, type SecondFactorSession } from "@/modules/auth/second-factor";
import { SESSION_COOKIE } from "@/modules/auth/session";

/**
 * Shared by the two setup routes (T8b); not a route itself. The proxy forwards
 * identity on these paths whatever the session's state, so the `enroll` state
 * is read from the database by the cookie's token, never from `x-user-*`.
 */
export async function enrollSession(
  request: NextRequest,
  find: typeof secondFactorSession = secondFactorSession,
): Promise<(SecondFactorSession & { token: string }) | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await find(token);
  return session?.pending === "enroll" ? { ...session, token } : null;
}

export const noPendingSession = () => NextResponse.json({ error: "no_pending_session" }, { status: 401 });
