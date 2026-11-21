import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { UNTIL_UNLOCKED } from "@/modules/auth/login-lock";
import type { SecondFactorResult } from "@/modules/auth/second-factor";
import { SESSION_COOKIE } from "@/modules/auth/session";

import { handleVerify } from "./route";

function request(body: unknown, token: string | null = "pending-token") {
  const headers: Record<string, string> = { "x-forwarded-for": "192.168.1.40" };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  return new NextRequest("http://localhost/api/two-factor/verify", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const respondWith = (result: SecondFactorResult) => vi.fn().mockResolvedValue(result);

describe("POST /api/two-factor/verify", () => {
  it("passes the cookie's token, the code and the client IP to the check", async () => {
    const verify = respondWith({ ok: false });

    await handleVerify(request({ code: "123456" }), { verify });

    expect(verify).toHaveBeenCalledWith({ token: "pending-token", code: "123456", ip: "192.168.1.40" });
  });

  it("passes a recovery code as a recovery code", async () => {
    const verify = respondWith({ ok: false });

    await handleVerify(request({ recoveryCode: "7KQM-2XPA" }), { verify });

    expect(verify).toHaveBeenCalledWith({ token: "pending-token", recoveryCode: "7KQM-2XPA", ip: "192.168.1.40" });
  });

  it("sets the full session cookie and sends the role to its landing on success", async () => {
    const expiresAt = new Date("2026-11-27T12:00:00.000Z");
    const verify = respondWith({ ok: true, token: "full-token", expiresAt, role: "pantalla" });

    const response = await handleVerify(request({ code: "123456" }), { verify });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/tablero/clientes" });
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ value: "full-token", httpOnly: true, sameSite: "lax", path: "/" });
    expect(new Date(cookie.expires!).getTime()).toBe(expiresAt.getTime());
  });

  it("asks to trust the device only when the body says exactly true", async () => {
    const verify = respondWith({ ok: false });

    await handleVerify(request({ code: "123456", trustDevice: true }), { verify });
    await handleVerify(request({ recoveryCode: "7KQM-2XPA", trustDevice: true }), { verify });
    await handleVerify(request({ code: "123456", trustDevice: "true" }), { verify });

    expect(verify).toHaveBeenNthCalledWith(1, { token: "pending-token", code: "123456", ip: "192.168.1.40", trustDevice: true });
    expect(verify).toHaveBeenNthCalledWith(2, {
      token: "pending-token",
      recoveryCode: "7KQM-2XPA",
      ip: "192.168.1.40",
      trustDevice: true,
    });
    expect(verify.mock.calls[2][0]).not.toHaveProperty("trustDevice");
  });

  it("sets the trusted_device cookie for 30 days when the check stored a device", async () => {
    const expiresAt = new Date("2026-12-20T12:00:00.000Z");
    const verify = respondWith({
      ok: true,
      token: "full-token",
      expiresAt: new Date("2026-11-27T12:00:00.000Z"),
      role: "tecnico",
      trustedDevice: { token: "device-token", expiresAt },
    });

    const response = await handleVerify(request({ code: "123456", trustDevice: true }), { verify });

    expect(await response.json()).toEqual({ ok: true, redirect: "/inventory" });
    const cookie = response.cookies.get("trusted_device")!;
    expect(cookie).toMatchObject({ value: "device-token", httpOnly: true, sameSite: "lax", path: "/" });
    expect(new Date(cookie.expires!).getTime()).toBe(expiresAt.getTime());
  });

  it("sets no trusted_device cookie when no device was stored", async () => {
    const verify = respondWith({ ok: true, token: "full-token", expiresAt: new Date(), role: "tecnico" });

    const response = await handleVerify(request({ code: "123456" }), { verify });

    expect(response.cookies.get("trusted_device")).toBeUndefined();
  });

  it("answers a wrong code with 401 invalid_code", async () => {
    const response = await handleVerify(request({ code: "000000" }), { verify: respondWith({ ok: false }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_code" });
  });

  it("answers a timed lock with 429 and Retry-After in seconds", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T12:00:00.000Z"), toFake: ["Date"] });
    const lockedUntil = new Date(Date.now() + 14 * 60_000 + 500);

    const response = await handleVerify(request({ code: "123456" }), { verify: respondWith({ ok: false, lockedUntil }) });
    vi.useRealTimers();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "locked" });
    expect(response.headers.get("Retry-After")).toBe(String(14 * 60 + 1));
  });

  it("answers a lock until an unlock with 429 and no Retry-After", async () => {
    const response = await handleVerify(request({ code: "123456" }), {
      verify: respondWith({ ok: false, lockedUntil: UNTIL_UNLOCKED }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("answers a session with nothing to verify with 401 no_pending_session", async () => {
    const response = await handleVerify(request({ code: "123456" }), {
      verify: respondWith({ ok: false, reason: "no_pending_session" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
  });

  it("answers no_pending_session without a cookie and never checks a code", async () => {
    const verify = respondWith({ ok: false });

    const response = await handleVerify(request({ code: "123456" }, null), { verify });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers a missing key with 503 unavailable", async () => {
    const response = await handleVerify(request({ code: "123456" }), {
      verify: respondWith({ ok: false, reason: "unavailable" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
