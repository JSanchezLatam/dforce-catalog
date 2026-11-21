import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_ISSUER, startRequiredEnrolment } from "@/modules/auth/enrolment";
import { getWorkshopConfig } from "@/modules/workshop-config/service";

import { refused } from "../../../account/two-factor/respond";
import { enrollSession, noPendingSession } from "../enroll-session";

/**
 * The mandatory setup's start (T8b, L41): a new unfinished secret for the user
 * of a database-read `enroll` session. No password, unlike Mi cuenta's
 * "Activar": that session comes from a password typed at most 30 minutes ago.
 */
export async function handleStart(
  request: NextRequest,
  deps: { findSession?: Parameters<typeof enrollSession>[1]; start?: typeof startRequiredEnrolment } = {},
): Promise<NextResponse> {
  const session = await enrollSession(request, deps.findSession);
  if (!session) return noPendingSession();

  // The issuer is per install (the workshop's name); auth never reads workshop_config itself.
  const issuer = (await getWorkshopConfig())?.name?.trim() || DEFAULT_ISSUER;
  const result = await (deps.start ?? startRequiredEnrolment)(session.userId, issuer);
  if (!result.ok) return refused(result);
  return NextResponse.json({ secret: result.secret, otpauthUri: result.otpauthUri, qrDataUrl: result.qrDataUrl });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleStart(request);
}
