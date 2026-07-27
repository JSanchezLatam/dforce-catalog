import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getUserProfile } from "@/modules/account/queries";
import { updateProfile } from "@/modules/account/service";

export async function GET(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const profile = await getUserProfile(user.id);
  return NextResponse.json({ profile });
}

export async function PATCH(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  await updateProfile(user.id, { name: body.name ?? null, email: body.email ?? null });
  return NextResponse.json({ success: true });
}
