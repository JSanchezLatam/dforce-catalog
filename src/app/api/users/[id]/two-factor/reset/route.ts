import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { resetTwoFactor as resetTwoFactorService } from "@/modules/auth/two-factor-reset";

/** An administrator resets another user's 2FA (S5); the actor comes from the session, never the body. */
export async function handleResetTwoFactor(
  request: NextRequest,
  id: string,
  deps: { resetTwoFactor?: typeof resetTwoFactorService } = {},
): Promise<NextResponse> {
  const actor = requireSession(request);
  if (!can(actor, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await (deps.resetTwoFactor ?? resetTwoFactorService)(actor.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "self_reset" ? 403 : 404 });
  }
  return NextResponse.json({ success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleResetTwoFactor(request, id);
}
