import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE } from "@/modules/auth/session";
import { handleLogout } from "./route";

function requestWithCookie(token?: string) {
  return new NextRequest("http://localhost/api/logout", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined,
  });
}

describe("POST /api/logout", () => {
  it("revokes the session and clears the cookie when one is present", async () => {
    const revokeSession = vi.fn().mockResolvedValue(undefined);

    const response = await handleLogout(requestWithCookie("token-1"), { revokeSession });

    expect(revokeSession).toHaveBeenCalledWith("token-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const cleared = response.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.expires && new Date(cleared.expires).getTime()).toBe(0);
  });

  it("still succeeds when no session cookie is present (no crash)", async () => {
    const revokeSession = vi.fn().mockResolvedValue(undefined);

    const response = await handleLogout(requestWithCookie(), { revokeSession });

    expect(revokeSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
