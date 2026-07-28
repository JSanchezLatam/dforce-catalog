import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

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
