import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/modules/auth/session";
import { changePassword, SamePasswordError } from "@/modules/account/service";

function getTokenId(request: NextRequest): string | null {
  const cookie = request.cookies.get("session");
  return cookie?.value ?? null;
}

/**
 * Deliberately session-only, NOT `can(user, "account.self")` — design.md
 * Decision 8. This is the only route that can clear a `mustChangePassword`
 * flag, so an Action gate here turns one matrix mistake into an unrecoverable
 * lockout. Authentication still applies (`requireSession` throws without it),
 * and the write is scoped to `user.id` from the session, never from the body.
 */
export async function POST(request: NextRequest) {
  const user = requireSession(request);

  const body = await request.json();

  try {
    await changePassword(user.id, body.currentPassword, body.newPassword, getTokenId(request) ?? "");
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SamePasswordError) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser distinta de la actual." },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "Invalid current password") {
      return NextResponse.json({ error: "Contraseña actual incorrecta." }, { status: 400 });
    }
    throw err;
  }
}
