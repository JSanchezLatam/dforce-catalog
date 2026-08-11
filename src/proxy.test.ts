import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { CHANGE_PASSWORD_PATH } from "@/modules/auth/forced-change";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { handleProxy } from "./proxy";

function pageRequest(path: string, token?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined,
  });
}

function apiRequest(path: string, token?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined,
  });
}

describe("handleProxy() — no session cookie at all (existing behavior, pinned)", () => {
  it("redirects a page navigation to /login", async () => {
    const response = await handleProxy(pageRequest("/inventory"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("returns 401 JSON for an API route", async () => {
    const response = await handleProxy(apiRequest("/api/customers"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("handleProxy() — invalid session (expired/revoked/deactivated), the fixed bug", () => {
  it("redirects a page navigation to /login", async () => {
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(pageRequest("/inventory", "bad-token"), { validateSession });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("returns 401 JSON for an API route — this is what proxy.ts got wrong before (it always redirected)", async () => {
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(apiRequest("/api/customers", "bad-token"), { validateSession });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("gate precedence + role-independence: a deactivated administrador's session is denied exactly like any other invalid session, on an API route, despite the matrix granting an administrador every action", async () => {
    // validateSession() already returns null for a deactivated user (session.ts
    // WU1 unit) — this pins that handleProxy() treats that null identically to
    // any other invalid session, and crucially never reaches the point where
    // x-user-role would be forwarded for policy.ts's can() to evaluate. The
    // block happens here, before role ever enters the picture.
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(apiRequest("/api/users", "deactivated-admin-token"), { validateSession });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects a page navigation for a deactivated administrador exactly like any other invalid session", async () => {
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(pageRequest("/inventory", "deactivated-admin-token"), { validateSession });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});

describe("handleProxy() — forced password change (design.md Decision 8)", () => {
  const flagged = { id: "user-1", role: "tecnico", mustChangePassword: true };

  it("redirects a page navigation to the change-password screen", async () => {
    const validateSession = vi.fn().mockResolvedValue(flagged);

    const response = await handleProxy(pageRequest("/inventory", "good-token"), { validateSession });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`http://localhost${CHANGE_PASSWORD_PATH}`);
  });

  it("returns 403 password_change_required for an API route, not a redirect a fetch() cannot follow", async () => {
    const validateSession = vi.fn().mockResolvedValue(flagged);

    const response = await handleProxy(apiRequest("/api/customers", "good-token"), { validateSession });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "password_change_required" });
  });

  it("blocks a flagged administrador too — the block is role-independent, exactly like deactivation", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({ id: "admin-1", role: "administrador", mustChangePassword: true });

    const response = await handleProxy(apiRequest("/api/users", "good-token"), { validateSession });

    expect(response.status).toBe(403);
  });

  // Without these three the flagged user hits an infinite redirect, a screen
  // that cannot submit, or a trap with no exit.
  it.each([CHANGE_PASSWORD_PATH, "/api/account/password", "/api/logout"])(
    "lets the exempt path %s through",
    async (path) => {
      const validateSession = vi.fn().mockResolvedValue(flagged);

      const response = await handleProxy(pageRequest(path, "good-token"), { validateSession });

      expect(response.status).not.toBe(403);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-request-x-user-id")).toBe("user-1");
    },
  );

  it("leaves an unflagged user completely unaffected", async () => {
    const validateSession = vi
      .fn()
      .mockResolvedValue({ id: "user-2", role: "tecnico", mustChangePassword: false });

    const response = await handleProxy(pageRequest("/inventory", "good-token"), { validateSession });

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-user-id")).toBe("user-2");
  });

  // Gate precedence: the session gate runs FIRST. A deactivated (or otherwise
  // invalid) session must never fall through to the forced-change branch and
  // get handed the change-password screen — it has no session to change a
  // password with. The exempt list must not become a session bypass.
  it("never reaches the forced-change branch for an invalid session, even on an exempt path", async () => {
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(pageRequest(CHANGE_PASSWORD_PATH, "bad-token"), { validateSession });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("returns 401, not 403, for an invalid session on the exempt password API route", async () => {
    const validateSession = vi.fn().mockResolvedValue(null);

    const response = await handleProxy(apiRequest("/api/account/password", "bad-token"), { validateSession });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("handleProxy() — valid session", () => {
  it("forwards x-user-id and x-user-role headers and lets the request through", async () => {
    const validateSession = vi.fn().mockResolvedValue({ id: "user-1", role: "administrador" });

    const response = await handleProxy(pageRequest("/inventory", "good-token"), { validateSession });

    // NextResponse.next({ request: { headers } }) is a passthrough — it re-encodes
    // the forwarded request headers as x-middleware-request-* (Next.js internal
    // convention), not as plain response headers.
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-user-id");
    expect(response.headers.get("x-middleware-request-x-user-id")).toBe("user-1");
    expect(response.headers.get("x-middleware-request-x-user-role")).toBe("administrador");
  });
});
