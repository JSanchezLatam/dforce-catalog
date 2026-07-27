import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "./route";

const mockGetProfile = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock("@/modules/account/queries", () => ({
  getUserProfile: (...args: unknown[]) => mockGetProfile(...args),
}));

vi.mock("@/modules/account/service", () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

function req(role: string, options?: { method?: string; body?: string }) {
  return new NextRequest("http://localhost/api/account", {
    method: options?.method,
    body: options?.body,
    headers: { "x-user-id": "user-1", "x-user-role": role, "Content-Type": "application/json" },
  });
}

describe("GET /api/account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns own profile", async () => {
    mockGetProfile.mockResolvedValue({ username: "juan", name: "Juan", email: "juan@taller.com", role: "tecnico" });
    const res = await GET(req("tecnico"));
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toEqual({ username: "juan", name: "Juan", email: "juan@taller.com", role: "tecnico" });
  });

  it("returns 403 when missing session headers", async () => {
    const r = new NextRequest("http://localhost/api/account");
    await expect(GET(r)).rejects.toThrow();
  });
});

describe("PATCH /api/account", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates profile", async () => {
    const res = await PATCH(req("tecnico", { method: "PATCH", body: JSON.stringify({ name: "Juan Updated" }) }));
    expect(res.status).toBe(200);
    expect(mockUpdateProfile).toHaveBeenCalledWith("user-1", { email: null, name: "Juan Updated" });
  });
});
