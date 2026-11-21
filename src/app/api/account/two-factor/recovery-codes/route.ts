import { NextResponse, type NextRequest } from "next/server";

import { regenerateRecoveryCodes } from "@/modules/auth/enrolment";
import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";

import { forbidden, readCode, refused } from "../respond";

/** "Generar códigos nuevos": needs a current app code; the old 10 stop working. */
export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return forbidden();

  const result = await regenerateRecoveryCodes(user.id, await readCode(request));
  if (!result.ok) return refused(result);
  return NextResponse.json({ codes: result.codes });
}
