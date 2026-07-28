import { describe, expect, it } from "vitest";

import { getUserProfile, listActiveAdminIds } from "./queries";

describe("getUserProfile", () => {
  it("returns profile when user exists", async () => {
    const profile = await getUserProfile("user-1", async () => ({
      username: "juan",
      name: "Juan Pérez",
      email: "juan@taller.com",
      role: "tecnico",
    }));
    expect(profile).toEqual({ username: "juan", name: "Juan Pérez", email: "juan@taller.com", role: "tecnico" });
  });

  it("returns null for unknown user", async () => {
    const profile = await getUserProfile("unknown", async () => null);
    expect(profile).toBeNull();
  });
});

describe("listActiveAdminIds", () => {
  it("returns the ids the injected query resolves — real query filters role=administrador AND deactivatedAt IS NULL", async () => {
    const ids = await listActiveAdminIds(async () => ["admin-1", "admin-2"]);
    expect(ids).toEqual(["admin-1", "admin-2"]);
  });

  it("returns an empty array when no active administrador exists", async () => {
    const ids = await listActiveAdminIds(async () => []);
    expect(ids).toEqual([]);
  });
});
