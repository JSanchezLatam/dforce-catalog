import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE } from "@/modules/auth/session";

import { handleConfirm } from "./route";

function request(body: unknown, token: string | null = "enroll-token") {
  return new NextRequest("http://localhost/api/two-factor/setup/confirm", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
    body: JSON.stringify(body),
  });
}

const session = (pending: "verify" | "enroll" | null, role: "administrador" | "jefe_taller" = "administrador") => ({
  userId: "u1",
  username: "admin",
  role,
  pending,
  createdAt: new Date(),
});

const codes = Array.from({ length: 10 }, (_, i) => `AAAA-000${i}`);
const expiresAt = new Date("2026-11-27T12:00:00.000Z");

const deps = (overrides: Parameters<typeof handleConfirm>[1] = {}) => ({
  findSession: vi.fn().mockResolvedValue(session("enroll")),
  confirm: vi.fn().mockResolvedValue({ ok: true, codes }),
  replaceSession: vi.fn().mockResolvedValue({ token: "full-token", expiresAt }),
  ...overrides,
});

describe("POST /api/two-factor/setup/confirm", () => {
  it("confirms the code for the enroll session's user, swaps the session, and answers the codes and the landing", async () => {
    const d = deps();

    const response = await handleConfirm(request({ code: "123456" }), d);

    expect(d.findSession).toHaveBeenCalledWith("enroll-token");
    expect(d.confirm).toHaveBeenCalledWith("u1", "123456");
    expect(d.replaceSession).toHaveBeenCalledWith("enroll-token", "u1", "administrador");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ codes, redirect: "/inventory" });
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ value: "full-token", httpOnly: true, sameSite: "lax", path: "/" });
    expect(new Date(cookie.expires!).getTime()).toBe(expiresAt.getTime());
  });

  it.each([
    ["no cookie", null, session("enroll")],
    ["no usable session", "enroll-token", null],
    ["a full session", "enroll-token", session(null)],
    ["a verify session", "enroll-token", session("verify")],
  ])("answers %s with 401 no_pending_session and confirms nothing", async (_label, token, found) => {
    const d = deps({ findSession: vi.fn().mockResolvedValue(found) });

    const response = await handleConfirm(request({ code: "123456" }, token), d);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.replaceSession).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_code", 400],
    ["unavailable", 503],
    ["not_enrolling", 409],
  ] as const)("answers %s with %i, sets no cookie and keeps the session", async (reason, status) => {
    const d = deps({ confirm: vi.fn().mockResolvedValue({ ok: false, reason }) });

    const response = await handleConfirm(request({ code: "000000" }), d);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(d.replaceSession).not.toHaveBeenCalled();
  });

  it("passes a body with no code as an empty code, which the service refuses", async () => {
    const d = deps({ confirm: vi.fn().mockResolvedValue({ ok: false, reason: "invalid_code" }) });

    await handleConfirm(request({}), d);

    expect(d.confirm).toHaveBeenCalledWith("u1", "");
  });

  // A parallel confirm or a logout got there first: the enroll session cannot become a full one twice.
  it("answers 401 no_pending_session and sets no cookie when the enroll session is gone by the swap", async () => {
    const d = deps({ replaceSession: vi.fn().mockResolvedValue(null) });

    const response = await handleConfirm(request({ code: "123456" }), d);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});
