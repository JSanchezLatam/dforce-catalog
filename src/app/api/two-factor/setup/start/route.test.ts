import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE } from "@/modules/auth/session";

const { getWorkshopConfig } = vi.hoisted(() => ({ getWorkshopConfig: vi.fn() }));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig }));

import { handleStart } from "./route";

function request(token: string | null = "enroll-token") {
  return new NextRequest("http://localhost/api/two-factor/setup/start", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

const session = (pending: "verify" | "enroll" | null) => ({
  userId: "u1",
  username: "jefe",
  role: "jefe_taller" as const,
  pending,
  createdAt: new Date(),
});

const started = { ok: true as const, secret: "JBSW Y3DP", otpauthUri: "otpauth://totp/x", qrDataUrl: "data:image/png;base64,x" };

beforeEach(() => {
  getWorkshopConfig.mockReset().mockResolvedValue({ name: "Dforce Car Audio" });
});

describe("POST /api/two-factor/setup/start", () => {
  it("starts the enrolment of the database-read enroll session's user, with the workshop as issuer", async () => {
    const findSession = vi.fn().mockResolvedValue(session("enroll"));
    const start = vi.fn().mockResolvedValue(started);

    const response = await handleStart(request(), { findSession, start });

    expect(findSession).toHaveBeenCalledWith("enroll-token");
    expect(start).toHaveBeenCalledWith("u1", "Dforce Car Audio");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ secret: "JBSW Y3DP", otpauthUri: "otpauth://totp/x", qrDataUrl: "data:image/png;base64,x" });
  });

  it("falls back to the default issuer when the workshop has no name", async () => {
    getWorkshopConfig.mockResolvedValue(null);
    const start = vi.fn().mockResolvedValue(started);

    await handleStart(request(), { findSession: vi.fn().mockResolvedValue(session("enroll")), start });

    expect(start).toHaveBeenCalledWith("u1", "DForce");
  });

  it.each([
    ["no cookie", null, session("enroll")],
    ["no usable session", "enroll-token", null],
    ["a full session", "enroll-token", session(null)],
    ["a verify session", "enroll-token", session("verify")],
  ])("answers %s with 401 no_pending_session and starts nothing", async (_label, token, found) => {
    const start = vi.fn();

    const response = await handleStart(request(token), { findSession: vi.fn().mockResolvedValue(found), start });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", 503],
    ["already_enabled", 409],
  ] as const)("answers %s with %i", async (reason, status) => {
    const response = await handleStart(request(), {
      findSession: vi.fn().mockResolvedValue(session("enroll")),
      start: vi.fn().mockResolvedValue({ ok: false, reason }),
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
  });
});
