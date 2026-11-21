import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import type { ResetTwoFactorResult } from "@/modules/auth/two-factor-reset";

import { handleResetTwoFactor } from "./route";

function req(role: string) {
  return new NextRequest("http://localhost/api/users/user-9/two-factor/reset", {
    method: "POST",
    headers: { "x-user-id": "admin-1", "x-user-role": role },
  });
}

const reset = (result: ResetTwoFactorResult) => vi.fn().mockResolvedValue(result);

describe("POST /api/users/[id]/two-factor/reset", () => {
  it("denies a jefe de taller without resetting anything", async () => {
    const resetTwoFactor = reset({ ok: true });

    const response = await handleResetTwoFactor(req("jefe_taller"), "user-9", { resetTwoFactor });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(resetTwoFactor).not.toHaveBeenCalled();
  });

  it("resets the target with the session user as the actor", async () => {
    const resetTwoFactor = reset({ ok: true });

    const response = await handleResetTwoFactor(req("administrador"), "user-9", { resetTwoFactor });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(resetTwoFactor).toHaveBeenCalledWith("admin-1", "user-9");
  });

  it("answers 403 self_reset for the caller's own id", async () => {
    const resetTwoFactor = reset({ ok: false, reason: "self_reset" });

    const response = await handleResetTwoFactor(req("administrador"), "admin-1", { resetTwoFactor });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "self_reset" });
  });

  it("answers 404 for a user that does not exist", async () => {
    const resetTwoFactor = reset({ ok: false, reason: "not_found" });

    const response = await handleResetTwoFactor(req("administrador"), "user-9", { resetTwoFactor });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
