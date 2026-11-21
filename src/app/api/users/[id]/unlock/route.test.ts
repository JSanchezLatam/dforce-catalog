import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { handleUnlockUser } from "./route";

function req(role: string) {
  return new NextRequest("http://localhost/api/users/user-9/unlock", {
    method: "POST",
    headers: { "x-user-id": "admin-1", "x-user-role": role, "x-forwarded-for": "192.168.1.5" },
  });
}

function deps(username: string | null = "mrodriguez") {
  return {
    findUser: vi.fn().mockResolvedValue(username === null ? null : { username }),
    unlockLogin: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /api/users/[id]/unlock", () => {
  it("denies a jefe de taller without unlocking anything", async () => {
    const d = deps();

    const response = await handleUnlockUser(req("jefe_taller"), "user-9", d);

    expect(response.status).toBe(403);
    expect(d.unlockLogin).not.toHaveBeenCalled();
  });

  it("unlocks the user's exact login, recording the address and the administrator who did it", async () => {
    const d = deps("MRodriguez");

    const response = await handleUnlockUser(req("administrador"), "user-9", d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(d.findUser).toHaveBeenCalledWith("user-9");
    expect(d.unlockLogin).toHaveBeenCalledWith({ userId: "user-9", username: "MRodriguez", ip: "192.168.1.5", actorId: "admin-1" });
  });

  it("returns 404 for a user that does not exist", async () => {
    const d = deps(null);

    const response = await handleUnlockUser(req("administrador"), "user-9", d);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(d.unlockLogin).not.toHaveBeenCalled();
  });
});
