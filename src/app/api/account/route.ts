import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { getUserProfile } from "@/modules/account/queries";
import { updateProfile, ProfileValidationError, DuplicateEmailError } from "@/modules/account/service";

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
  try {
    await updateProfile(user.id, { name: body.name ?? null, email: body.email ?? null });
  } catch (err) {
    if (err instanceof ProfileValidationError) {
      return NextResponse.json({ error: "validation_error", errors: err.errors }, { status: 400 });
    }
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json({ error: "duplicate_email" }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ success: true });
}
