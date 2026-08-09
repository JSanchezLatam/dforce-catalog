import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { AdminSafetyError, ProfileValidationError, UserNotFoundError, DuplicateEmailError } from "@/modules/account/service";
import { handleUpdateUser } from "./route";

function req(role: string, body: unknown) {
  return new NextRequest("http://localhost/api/users/user-9", {
    method: "PATCH",
    headers: { "x-user-id": "admin-1", "x-user-role": role, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    updateUser: vi.fn().mockResolvedValue(undefined),
    deactivateUser: vi.fn().mockResolvedValue(undefined),
    reactivateUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("users.manage gating", () => {
  it("denies a técnico without running any mutation", async () => {
    const d = deps();

    const response = await handleUpdateUser(req("tecnico", { name: "X" }), "user-9", d);

    expect(response.status).toBe(403);
    expect(d.updateUser).not.toHaveBeenCalled();
    expect(d.deactivateUser).not.toHaveBeenCalled();
    expect(d.reactivateUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/[id] — field edits", () => {
  it("passes the actor from the session, never from the body", async () => {
    const d = deps();

    await handleUpdateUser(req("administrador", { name: "Ana Ruiz", actorId: "spoofed" }), "user-9", d);

    // Exactly the whitelisted field — `actorId` from the body is dropped, not
    // merely ignored downstream.
    expect(d.updateUser).toHaveBeenCalledWith("admin-1", "user-9", { name: "Ana Ruiz" });
  });

  it("returns 200 on a successful edit", async () => {
    const response = await handleUpdateUser(req("administrador", { role: "administrador" }), "user-9", deps());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("forwards an admin password reset", async () => {
    const d = deps();

    await handleUpdateUser(req("administrador", { password: "nuevatemp1" }), "user-9", d);

    expect(d.updateUser.mock.calls[0][2]).toMatchObject({ password: "nuevatemp1" });
  });
});

describe("PATCH /api/users/[id] — activation", () => {
  it("routes active:false to the transactional deactivate path", async () => {
    const d = deps();

    await handleUpdateUser(req("administrador", { active: false }), "user-9", d);

    expect(d.deactivateUser).toHaveBeenCalledWith("admin-1", "user-9");
    expect(d.reactivateUser).not.toHaveBeenCalled();
  });

  it("routes active:true to reactivate", async () => {
    const d = deps();

    await handleUpdateUser(req("administrador", { active: true }), "user-9", d);

    expect(d.reactivateUser).toHaveBeenCalledWith("user-9");
    expect(d.deactivateUser).not.toHaveBeenCalled();
  });

  it("does not touch activation when the field is absent", async () => {
    const d = deps();

    await handleUpdateUser(req("administrador", { name: "Ana" }), "user-9", d);

    expect(d.deactivateUser).not.toHaveBeenCalled();
    expect(d.reactivateUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/[id] — failure mapping", () => {
  it("returns 400 carrying the safety reason when demoting the last administrador", async () => {
    const d = deps({ updateUser: vi.fn().mockRejectedValue(new AdminSafetyError("last_active_admin")) });

    const response = await handleUpdateUser(req("administrador", { role: "tecnico" }), "user-9", d);

    expect(response.status).toBe(400);
    // The reason travels to the client: the table renders a specific inline
    // message, and "something went wrong" would not tell the admin why.
    expect((await response.json()).error).toBe("last_active_admin");
  });

  it("returns 400 with the self-violation reason from the deactivate path too", async () => {
    const d = deps({ deactivateUser: vi.fn().mockRejectedValue(new AdminSafetyError("self_deactivate")) });

    const response = await handleUpdateUser(req("administrador", { active: false }), "user-9", d);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("self_deactivate");
  });

  it("returns 404 for a missing user", async () => {
    const d = deps({ updateUser: vi.fn().mockRejectedValue(new UserNotFoundError()) });

    const response = await handleUpdateUser(req("administrador", { name: "X" }), "ghost", d);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });

  it("returns 400 with field errors on invalid input", async () => {
    const d = deps({
      updateUser: vi.fn().mockRejectedValue(new ProfileValidationError({ email: "Email must be a valid email address" })),
    });

    const response = await handleUpdateUser(req("administrador", { email: "nope" }), "user-9", d);

    expect(response.status).toBe(400);
    expect((await response.json()).errors.email).toBeTruthy();
  });

  it("returns 409 on a duplicate email", async () => {
    const d = deps({ updateUser: vi.fn().mockRejectedValue(new DuplicateEmailError()) });

    const response = await handleUpdateUser(req("administrador", { email: "taken@taller.com" }), "user-9", d);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("duplicate_email");
  });
});
