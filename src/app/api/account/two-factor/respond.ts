import { NextResponse } from "next/server";

import type { EnrolmentFailure } from "@/modules/auth/enrolment";

/** Shared by the four 2FA routes under Mi cuenta (T8a); not a route itself. */
const STATUS: Record<EnrolmentFailure["reason"], number> = {
  invalid_password: 400,
  invalid_code: 400,
  code_used: 409,
  locked: 429,
  required_for_role: 403,
  already_enabled: 409,
  not_enrolling: 409,
  not_enabled: 409,
  unavailable: 503,
};

export const refused = (failure: EnrolmentFailure) =>
  NextResponse.json({ error: failure.reason }, { status: STATUS[failure.reason] });

export const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

/** The typed code, or "" for any other body, which the service refuses as not six digits. */
export async function readCode(request: Request): Promise<string> {
  const body = await request.json().catch(() => null);
  return typeof body?.code === "string" ? body.code : "";
}
