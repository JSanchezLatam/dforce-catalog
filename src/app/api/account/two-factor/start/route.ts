import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_ISSUER, startEnrolment } from "@/modules/auth/enrolment";
import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getWorkshopConfig } from "@/modules/workshop-config/service";

import { forbidden, refused } from "../respond";

/** "Activar": a new unfinished secret for the session user, never one named in the body. */
export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return forbidden();

  // The issuer is per install (the workshop's name); auth never reads workshop_config itself.
  const issuer = (await getWorkshopConfig())?.name?.trim() || DEFAULT_ISSUER;
  const result = await startEnrolment(user.id, issuer);
  if (!result.ok) return refused(result);
  return NextResponse.json({ secret: result.secret, otpauthUri: result.otpauthUri, qrDataUrl: result.qrDataUrl });
}
