import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
vi.mock("@/modules/auth/authenticate", () => ({ authenticateUser }));

import { UNTIL_UNLOCKED } from "@/modules/auth/login-lock";

import { POST } from "./route";

const login = () =>
  POST(new NextRequest("http://192.168.0.7:3000/api/login", { method: "POST", body: JSON.stringify({ username: "u", password: "p" }) }));

describe("POST /api/login", () => {
  it("Cookie follows expiry: the session cookie expires with the issued session", async () => {
    const expiresAt = new Date("2027-04-24T15:00:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "t", expiresAt, role: "pantalla" });

    const cookie = (await login()).cookies.get("session");

    expect(cookie?.value).toBe("t");
    expect(cookie?.expires).toEqual(expiresAt);
  });

  it("answers a full login with ok and the role only", async () => {
    authenticateUser.mockResolvedValue({ ok: true, token: "t", expiresAt: new Date(Date.now() + 60_000), role: "tecnico" });

    expect(await (await login()).json()).toEqual({ ok: true, role: "tecnico" });
  });

  it("answers a 2FA user's right password with a pending session that expires with it", async () => {
    const expiresAt = new Date("2026-11-20T12:10:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "p", expiresAt, role: "administrador", pending: "verify" });

    const response = await login();

    expect(await response.json()).toEqual({ ok: true, role: "administrador", pending: "verify" });
    expect(response.cookies.get("session")?.value).toBe("p");
    expect(response.cookies.get("session")?.expires).toEqual(expiresAt);
  });

  it("answers a mandatory role without 2FA with an enroll session that expires with it", async () => {
    const expiresAt = new Date("2026-11-20T12:30:00.000Z");
    authenticateUser.mockResolvedValue({ ok: true, token: "e", expiresAt, role: "jefe_taller", pending: "enroll" });

    const response = await login();

    expect(await response.json()).toEqual({ ok: true, role: "jefe_taller", pending: "enroll" });
    expect(response.cookies.get("session")?.value).toBe("e");
    expect(response.cookies.get("session")?.expires).toEqual(expiresAt);
  });

  it("answers a locked login with 429, the wait, and no cookie", async () => {
    authenticateUser.mockResolvedValue({ ok: false, lockedUntil: new Date(Date.now() + 90_000) });

    const response = await login();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "locked" });
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.cookies.get("session")).toBeUndefined();
  });

  it("answers a login locked until an unlock with 429 and no Retry-After", async () => {
    authenticateUser.mockResolvedValue({ ok: false, lockedUntil: UNTIL_UNLOCKED });

    const response = await login();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "locked" });
    expect(response.headers.get("retry-after")).toBeNull();
  });

  it("passes the client IP to the credential check", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    await POST(
      new NextRequest("http://192.168.0.7:3000/api/login", {
        method: "POST",
        headers: { "x-forwarded-for": "192.168.1.23" },
        body: JSON.stringify({ username: "ana", password: "clave" }),
      }),
    );

    expect(authenticateUser).toHaveBeenLastCalledWith("ana", "clave", { ip: "192.168.1.23" });
  });

  it("passes the trusted_device cookie to the credential check", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    await POST(
      new NextRequest("http://192.168.0.7:3000/api/login", {
        method: "POST",
        headers: { "x-forwarded-for": "192.168.1.23", cookie: "trusted_device=device-token" },
        body: JSON.stringify({ username: "ana", password: "clave" }),
      }),
    );

    expect(authenticateUser).toHaveBeenLastCalledWith("ana", "clave", {
      ip: "192.168.1.23",
      trustedDeviceToken: "device-token",
    });
  });

  it("refuses bad credentials with 401 and sets no cookie", async () => {
    authenticateUser.mockResolvedValue({ ok: false });

    const response = await login();

    expect(response.status).toBe(401);
    expect(response.cookies.get("session")).toBeUndefined();
  });
});
