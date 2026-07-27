import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mockChangePassword = vi.fn();

vi.mock("@/modules/account/service", () => ({
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
});
