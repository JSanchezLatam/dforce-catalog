import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE } from "@/modules/auth/session";
import { handleLogout } from "./route";

function requestWithCookie(token?: string, extra: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/logout", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}`, ...extra } : extra,
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

  // S11: the cleared cookie must match the one it replaces, secure over the tunnel and plain on the LAN.
  it.each([
    ["secure over the HTTPS tunnel", { "x-forwarded-proto": "https" }, true],
    ["not secure on the plain-HTTP LAN", { "x-forwarded-proto": "http" }, false],
    ["not secure with no forwarded protocol", {}, false],
  ])("clears the session cookie %s", async (_label, headers, secure) => {
    const response = await handleLogout(requestWithCookie("token-1", headers), { revokeSession: vi.fn() });

    const cleared = response.cookies.get(SESSION_COOKIE)!;
    expect(cleared).toMatchObject({ value: "", httpOnly: true, sameSite: "lax", path: "/", secure });
    expect(new Date(cleared.expires!).getTime()).toBe(0);
  });
});
