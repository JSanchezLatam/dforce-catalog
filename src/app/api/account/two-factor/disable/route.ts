import { NextResponse, type NextRequest } from "next/server";

import { disableTwoFactor } from "@/modules/auth/enrolment";
import { can } from "@/modules/auth/policy";
import { requireSession, SESSION_COOKIE } from "@/modules/auth/session";

import { forbidden, readCode, refused } from "../respond";

/**
 * "Desactivar": needs a current app code, and the role comes from the session,
 * so a mandatory role (S2) cannot claim another one. Every other session is revoked.
 */
export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return forbidden();
  // Without it, the keep-token would be empty and this session would be revoked with the rest.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "no_session" }, { status: 401 });

  const result = await disableTwoFactor(user.id, user.role, await readCode(request), token);
  if (!result.ok) return refused(result);
  return NextResponse.json({ success: true });
}
