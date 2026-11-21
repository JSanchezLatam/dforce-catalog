import { NextResponse, type NextRequest } from "next/server";

import { confirmEnrolment } from "@/modules/auth/enrolment";
import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";

import { forbidden, readCode, refused } from "../respond";

/** Checks the app code against the unfinished secret; answers the recovery codes, shown once. */
export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return forbidden();

  const result = await confirmEnrolment(user.id, await readCode(request));
  if (!result.ok) return refused(result);
  return NextResponse.json({ codes: result.codes });
}
