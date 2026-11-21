import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startEnrolment = vi.hoisted(() => vi.fn());
const confirmEnrolment = vi.hoisted(() => vi.fn());
const regenerateRecoveryCodes = vi.hoisted(() => vi.fn());
const disableTwoFactor = vi.hoisted(() => vi.fn());
const getWorkshopConfig = vi.hoisted(() => vi.fn());

vi.mock("@/modules/auth/enrolment", async (original) => ({
  ...(await original<typeof import("@/modules/auth/enrolment")>()),
  startEnrolment,
  confirmEnrolment,
  regenerateRecoveryCodes,
  disableTwoFactor,
}));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig }));

import { POST as CONFIRM } from "./confirm/route";
import { POST as DISABLE } from "./disable/route";
import { POST as RECOVERY_CODES } from "./recovery-codes/route";
import { POST as START } from "./start/route";

function req(path: string, role: string, body?: object, cookie: string | null = "session=token-1") {
  return new NextRequest(`http://localhost/api/account/two-factor/${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkshopConfig.mockResolvedValue({ name: "Taller Fuerza" });
});

describe("account.self gate", () => {
  it.each([
    ["start", START, startEnrolment],
    ["confirm", CONFIRM, confirmEnrolment],
    ["recovery-codes", RECOVERY_CODES, regenerateRecoveryCodes],
    ["disable", DISABLE, disableTwoFactor],
  ] as const)("%s answers 403 for pantalla and never reaches the service", async (path, handler, service) => {
    const res = await handler(req(path, "pantalla", { code: "123456" }));
    expect(res.status).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/two-factor/start", () => {
  it("starts for the session user with the workshop name as issuer", async () => {
    startEnrolment.mockResolvedValue({ ok: true, secret: "ABCD EFGH", otpauthUri: "otpauth://x", qrDataUrl: "data:x" });

    const res = await START(req("start", "tecnico", { password: "clave-actual", userId: "someone-else" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secret: "ABCD EFGH", otpauthUri: "otpauth://x", qrDataUrl: "data:x" });
    expect(startEnrolment).toHaveBeenCalledWith("user-1", "clave-actual", "Taller Fuerza");
  });

  it.each([null, { name: null }, { name: "   " }])("falls back to DForce when the workshop config is %j", async (config) => {
    getWorkshopConfig.mockResolvedValue(config);
    startEnrolment.mockResolvedValue({ ok: true, secret: "A", otpauthUri: "o", qrDataUrl: "d" });

    await START(req("start", "tecnico", { password: "clave-actual" }));

    expect(startEnrolment).toHaveBeenCalledWith("user-1", "clave-actual", "DForce");
  });

  it.each([undefined, { password: 1234 }, { password: null }])("passes the body %j as an empty password, which the service refuses", async (body) => {
    startEnrolment.mockResolvedValue({ ok: false, reason: "invalid_password" });
    await START(req("start", "tecnico", body));
    expect(startEnrolment).toHaveBeenCalledWith("user-1", "", "Taller Fuerza");
  });

  it.each([
    ["invalid_password", 400],
    ["already_enabled", 409],
    ["unavailable", 503],
  ])("maps %s to %i", async (reason, status) => {
    startEnrolment.mockResolvedValue({ ok: false, reason });
    const res = await START(req("start", "tecnico"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
  });
});

describe("POST /api/account/two-factor/confirm", () => {
  it("confirms the session user's code and returns the codes", async () => {
    confirmEnrolment.mockResolvedValue({ ok: true, codes: ["AAAA-BBBB"] });

    const res = await CONFIRM(req("confirm", "tecnico", { code: "123456", userId: "someone-else" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ codes: ["AAAA-BBBB"] });
    expect(confirmEnrolment).toHaveBeenCalledWith("user-1", "123456");
  });

  it.each([
    ["invalid_code", 400],
    ["not_enrolling", 409],
    ["unavailable", 503],
  ])("maps %s to %i", async (reason, status) => {
    confirmEnrolment.mockResolvedValue({ ok: false, reason });
    const res = await CONFIRM(req("confirm", "tecnico", { code: "123456" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
  });

  it("passes an unreadable body as an empty code, which the service refuses", async () => {
    confirmEnrolment.mockResolvedValue({ ok: false, reason: "invalid_code" });
    await CONFIRM(req("confirm", "tecnico", { code: 123456 }));
    expect(confirmEnrolment).toHaveBeenCalledWith("user-1", "");
  });
});

describe("POST /api/account/two-factor/recovery-codes", () => {
  it("regenerates for the session user and returns the new codes", async () => {
    regenerateRecoveryCodes.mockResolvedValue({ ok: true, codes: ["CCCC-DDDD"] });

    const res = await RECOVERY_CODES(req("recovery-codes", "jefe_taller", { code: "654321" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ codes: ["CCCC-DDDD"] });
    expect(regenerateRecoveryCodes).toHaveBeenCalledWith("user-1", "654321");
  });

  it.each([
    ["invalid_code", 400],
    ["code_used", 409],
    ["locked", 429],
    ["not_enabled", 409],
    ["unavailable", 503],
  ])("maps %s to %i", async (reason, status) => {
    regenerateRecoveryCodes.mockResolvedValue({ ok: false, reason });
    const res = await RECOVERY_CODES(req("recovery-codes", "tecnico", { code: "123456" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
  });
});

describe("POST /api/account/two-factor/disable", () => {
  it("disables with the session's role and keeps the session's own token", async () => {
    disableTwoFactor.mockResolvedValue({ ok: true });

    // A mandatory role claiming an optional one in the body must still be judged as itself (S2).
    const res = await DISABLE(req("disable", "administrador", { code: "123456", role: "tecnico", userId: "other" }));

    expect(res.status).toBe(200);
    expect(disableTwoFactor).toHaveBeenCalledWith("user-1", "administrador", "123456", "token-1");
  });

  // An empty keep-token would revoke the current session too.
  it("answers 401 without a session cookie and never disables", async () => {
    const res = await DISABLE(req("disable", "tecnico", { code: "123456" }, null));
    expect(res.status).toBe(401);
    expect(disableTwoFactor).not.toHaveBeenCalled();
  });

  it.each([
    ["required_for_role", 403],
    ["invalid_code", 400],
    ["code_used", 409],
    ["locked", 429],
    ["not_enabled", 409],
    ["unavailable", 503],
  ])("maps %s to %i", async (reason, status) => {
    disableTwoFactor.mockResolvedValue({ ok: false, reason });
    const res = await DISABLE(req("disable", "administrador", { code: "123456" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
  });
});
