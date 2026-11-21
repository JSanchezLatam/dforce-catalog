import { NextResponse, type NextRequest } from "next/server";

import { clientIp } from "@/modules/auth/client-ip";
import { landingPathFor } from "@/modules/auth/landing";
import { isUntilUnlocked } from "@/modules/auth/login-lock";
import { verifySecondFactor } from "@/modules/auth/second-factor";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { TRUSTED_DEVICE_COOKIE } from "@/modules/auth/trusted-device";

/**
 * The second step of a 2FA login (T7). The proxy lets a pending session reach
 * this path and forwards its identity, so nothing here reads `x-user-*`: the
 * token is checked against the database, where `pending` lives. Split from
 * `POST` like `api/logout/route.ts`, so tests can inject the check.
 */
export async function handleVerify(
  request: NextRequest,
  deps: { verify?: typeof verifySecondFactor } = {},
): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "no_pending_session" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const typed =
    typeof body?.recoveryCode === "string"
      ? { recoveryCode: body.recoveryCode as string }
      : { code: typeof body?.code === "string" ? (body.code as string) : "" };
  // Only an explicit true: the box is unchecked by default (L45).
  const trust = body?.trustDevice === true ? { trustDevice: true } : {};

  const result = await (deps.verify ?? verifySecondFactor)({ token, ...typed, ip: clientIp(request.headers), ...trust });
  if (result.ok) {
    const response = NextResponse.json({ ok: true, redirect: landingPathFor(result.role) });
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      expires: result.expiresAt,
      path: "/",
    });
    if (result.trustedDevice) {
      response.cookies.set(TRUSTED_DEVICE_COOKIE, result.trustedDevice.token, {
        httpOnly: true,
        sameSite: "lax",
        expires: result.trustedDevice.expiresAt,
        path: "/",
      });
    }
    return response;
  }
  if (result.lockedUntil) {
    if (isUntilUnlocked(result.lockedUntil)) return NextResponse.json({ error: "locked" }, { status: 429 });
    const retryAfter = Math.ceil((result.lockedUntil.getTime() - Date.now()) / 1000);
    return NextResponse.json({ error: "locked" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  if (result.reason === "unavailable") return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (result.reason === "no_pending_session") return NextResponse.json({ error: "no_pending_session" }, { status: 401 });
  return NextResponse.json({ error: "invalid_code" }, { status: 401 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleVerify(request);
}
