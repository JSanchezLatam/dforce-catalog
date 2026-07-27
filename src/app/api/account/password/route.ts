import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { changePassword } from "@/modules/account/service";

function getTokenId(request: NextRequest): string | null {
  const cookie = request.cookies.get("session");
  return cookie?.value ?? null;
}

export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  try {
    await changePassword(user.id, body.currentPassword, body.newPassword, getTokenId(request) ?? "");
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid current password") {
      return NextResponse.json({ error: "Contraseña actual incorrecta." }, { status: 400 });
    }
    throw err;
  }
}
