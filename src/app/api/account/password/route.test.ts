import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mockChangePassword = vi.fn();

// Partial mock: `SamePasswordError` must stay the REAL class, or the route's
// `instanceof` branch silently stops matching and every same-password
// rejection falls through to an unhandled 500.
vi.mock("@/modules/account/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/account/service")>()),
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

function req(role: string, body?: string) {
  return new NextRequest("http://localhost/api/account/password", {
    method: "POST",
    body,
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json", cookie: "session=token-1" },
  });
}

describe("POST /api/account/password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changes password successfully", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const res = await POST(req("tecnico", JSON.stringify({ currentPassword: "old", newPassword: "new" })));
    expect(res.status).toBe(200);
    expect(mockChangePassword).toHaveBeenCalledWith("user-1", "old", "new", "token-1");
  });

  it("returns 400 on wrong current password", async () => {
    mockChangePassword.mockRejectedValue(new Error("Invalid current password"));
    const res = await POST(req("tecnico", JSON.stringify({ currentPassword: "wrong", newPassword: "new" })));
    expect(res.status).toBe(400);
  });

  it("returns 400 with a distinct message when the new password repeats the temporary one", async () => {
    const { SamePasswordError } = await import("@/modules/account/service");
    mockChangePassword.mockRejectedValue(new SamePasswordError());

    const res = await POST(req("tecnico", JSON.stringify({ currentPassword: "temp", newPassword: "temp" })));

    expect(res.status).toBe(400);
    // Distinct from "Contraseña actual incorrecta." — a user told their correct
    // password is wrong has no idea what to do next.
    expect((await res.json()).error).toBe("La nueva contraseña debe ser distinta de la actual.");
  });

  // The route is registered "session-only" (design.md Decision 8): a técnico is
  // NOT forbidden here, because this is the only route that can clear a forced
  // rotation. Pinned so nobody re-adds an Action gate.
  it("serves a técnico — the unlock path is never role-gated", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const res = await POST(req("tecnico", JSON.stringify({ currentPassword: "old", newPassword: "new" })));
    expect(res.status).toBe(200);
  });
});
