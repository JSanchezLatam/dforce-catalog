import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { handleCreateUser, handleListUsers } from "./route";

const VALID = { username: "ana", password: "temporal1", role: "tecnico" };

function req(role: string, init: { body?: unknown; query?: string } = {}) {
  const url = `http://localhost/api/users${init.query ?? ""}`;
  return new NextRequest(url, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { "x-user-id": "admin-1", "x-user-role": role, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/**
 * Spec `user-management` — "Admin-Only Access": a técnico requesting this
 * surface directly MUST be denied AND the route MUST NOT execute business
 * logic. Asserting the injected dependency was never called is the part that
 * proves the second half — a 403 returned *after* the work ran would still
 * pass a status-only assertion.
 */
describe("users.manage gating", () => {
  it("denies a técnico on GET without listing anything", async () => {
    const listUsers = vi.fn();

    const response = await handleListUsers(req("tecnico"), { listUsers });

    expect(response.status).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("denies a técnico on POST without creating anything", async () => {
    const createUser = vi.fn();

    const response = await handleCreateUser(req("tecnico", { body: VALID }), { createUser });

    expect(response.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("throws without session headers — proxy.ts is what validates, not this route", async () => {
    const bare = new NextRequest("http://localhost/api/users");
    await expect(handleListUsers(bare, { listUsers: vi.fn() })).rejects.toThrow();
  });
});

describe("GET /api/users", () => {
  const ROWS = [
    { id: "u-1", username: "ana", name: "Ana", email: null, role: "tecnico", deactivatedAt: null },
  ];

  it("lists active users for an administrador", async () => {
    const listUsers = vi.fn().mockResolvedValue(ROWS);

    const response = await handleListUsers(req("administrador"), { listUsers });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: ROWS });
  });

  it("asks for active users only when no query string is present", async () => {
    const listUsers = vi.fn().mockResolvedValue(ROWS);

    await handleListUsers(req("administrador"), { listUsers });

    expect(listUsers).toHaveBeenCalledWith({ includeInactive: false });
  });

  it("includes inactive users when ?includeInactive=true", async () => {
    const listUsers = vi.fn().mockResolvedValue(ROWS);

    await handleListUsers(req("administrador", { query: "?includeInactive=true" }), { listUsers });

    expect(listUsers).toHaveBeenCalledWith({ includeInactive: true });
  });

  // Anything other than the literal "true" is the safe, smaller set — a
  // stray ?includeInactive=1 must not silently widen what an admin sees.
  it.each(["?includeInactive=1", "?includeInactive=yes", "?includeInactive="])(
    "treats %s as active-only",
    async (query) => {
      const listUsers = vi.fn().mockResolvedValue(ROWS);

      await handleListUsers(req("administrador", { query }), { listUsers });

      expect(listUsers).toHaveBeenCalledWith({ includeInactive: false });
    },
  );
});

describe("POST /api/users", () => {
  it("creates and returns 201 with the new id", async () => {
    const createUser = vi.fn().mockResolvedValue({ id: "new-user" });

    const response = await handleCreateUser(req("administrador", { body: VALID }), { createUser });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ user: { id: "new-user" } });
  });

  it("returns 400 with field errors on invalid input", async () => {
    const response = await handleCreateUser(
      req("administrador", { body: { username: "", password: "abc", role: "nope" } }),
      {},
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors.username).toBeTruthy();
    expect(body.errors.password).toBeTruthy();
    expect(body.errors.role).toBeTruthy();
  });

  it("returns 409 on a duplicate email", async () => {
    const response = await handleCreateUser(
      req("administrador", { body: { ...VALID, email: "taken@taller.com" } }),
      { findByUsername: async () => null, findByEmail: async () => ({ id: "existing" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("duplicate_email");
  });

  // Distinct code from duplicate_email: the form needs to know WHICH field to
  // mark, and username collisions are the more common admin mistake.
  it("returns 409 with a distinct code on a duplicate username", async () => {
    const response = await handleCreateUser(req("administrador", { body: VALID }), {
      findByUsername: async () => ({ id: "existing" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("duplicate_username");
  });
});
