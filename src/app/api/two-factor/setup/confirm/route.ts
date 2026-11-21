import { NextResponse, type NextRequest } from "next/server";

import { confirmEnrolment } from "@/modules/auth/enrolment";
import { landingPathFor } from "@/modules/auth/landing";
import { replaceEnrollSession, SESSION_COOKIE } from "@/modules/auth/session";

import { readCode, refused } from "../../../account/two-factor/respond";
import { enrollSession, noPendingSession } from "../enroll-session";

/**
 * The mandatory setup's confirm (T8b, L41): enables 2FA, swaps the `enroll`
 * session for a full one, and answers the 10 recovery codes, shown once.
 *
 * A wrong code is `invalid_code` and does NOT count toward the user lock, as in
 * Mi cuenta's confirm: the code is checked against a secret this very session
 * created moments ago, so a guess here proves nothing about any factor an
 * attacker could later use. The lock protects existing factors; there is none yet.
 */
export async function handleConfirm(
  request: NextRequest,
  deps: {
    findSession?: Parameters<typeof enrollSession>[1];
    confirm?: typeof confirmEnrolment;
    replaceSession?: typeof replaceEnrollSession;
  } = {},
): Promise<NextResponse> {
  const session = await enrollSession(request, deps.findSession);
  if (!session) return noPendingSession();

  const result = await (deps.confirm ?? confirmEnrolment)(session.userId, await readCode(request));
  if (!result.ok) return refused(result);

  // 2FA is on from here. Should the swap fail, the next login asks for the code (T6).
  const full = await (deps.replaceSession ?? replaceEnrollSession)(session.token, session.userId, session.role);
  if (!full) return noPendingSession();

  const response = NextResponse.json({ codes: result.codes, redirect: landingPathFor(session.role) });
  response.cookies.set(SESSION_COOKIE, full.token, {
    httpOnly: true,
    sameSite: "lax",
    expires: full.expiresAt,
    path: "/",
  });
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleConfirm(request);
}
