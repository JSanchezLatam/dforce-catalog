import { NextResponse, type NextRequest } from "next/server";

import { getUserProfile } from "@/modules/account/queries";
import { clientIp } from "@/modules/auth/client-ip";
import { unlockLogin as unlockLoginService } from "@/modules/auth/login-attempts";
import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";

type UnlockUserDeps = {
  findUser?: (id: string) => Promise<{ username: string } | null>;
  unlockLogin?: typeof unlockLoginService;
};

/** Lets an administrator open a locked login before its lock ends, or a lock that never ends on its own. */
export async function handleUnlockUser(
  request: NextRequest,
  id: string,
  deps: UnlockUserDeps = {},
): Promise<NextResponse> {
  const actor = requireSession(request);
  if (!can(actor, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await (deps.findUser ?? getUserProfile)(id);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await (deps.unlockLogin ?? unlockLoginService)({
    userId: id,
    username: user.username,
    ip: clientIp(request.headers),
    actorId: actor.id,
  });
  return NextResponse.json({ success: true });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleUnlockUser(request, id);
}
