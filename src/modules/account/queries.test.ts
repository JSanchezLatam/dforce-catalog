import { describe, expect, it } from "vitest";

import { getUserProfile } from "./queries";

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
