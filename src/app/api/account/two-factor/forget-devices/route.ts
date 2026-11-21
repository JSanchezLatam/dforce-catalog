import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { revokeTrustedDevices } from "@/modules/auth/trusted-device";

import { forbidden } from "../respond";

/**
 * "Olvidar dispositivos de confianza" (T9): every browser of the session user
 * asks for the code again. It only takes access away, so it needs no code.
 */
export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "account.self")) return forbidden();

  await revokeTrustedDevices(user.id);
  return NextResponse.json({ success: true });
}
