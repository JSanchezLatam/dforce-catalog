import { describe, expect, it, vi } from "vitest";

import { getUserProfile, listActiveAdminIds, listUsers } from "./queries";

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

/**
 * The `includeInactive` flag is threaded INTO the query seam rather than the
 * seam being swapped wholesale, so these tests actually pin which set the
 * caller asked for. A passthrough-only test (the shape the two suites below
 * use) could not tell active-only from include-everything.
 */
describe("listUsers", () => {
  const ROWS = [
    { id: "u-1", username: "juan", name: "Juan", email: "juan@taller.com", role: "tecnico", deactivatedAt: null },
  ];

  it("asks for active users only when no options are passed", async () => {
    const queryFn = vi.fn().mockResolvedValue(ROWS);

    await listUsers({}, queryFn);

    expect(queryFn).toHaveBeenCalledWith(false);
  });

  it("asks for active users only when the argument is omitted entirely", async () => {
    const queryFn = vi.fn().mockResolvedValue(ROWS);

    await listUsers(undefined, queryFn);

    expect(queryFn).toHaveBeenCalledWith(false);
  });

  it("includes deactivated users only when explicitly asked", async () => {
    const queryFn = vi.fn().mockResolvedValue(ROWS);

    await listUsers({ includeInactive: true }, queryFn);

    expect(queryFn).toHaveBeenCalledWith(true);
  });

  it("returns the rows the query resolves, deactivatedAt included so the UI can grey inactive rows", async () => {
    const inactive = { ...ROWS[0], id: "u-2", username: "ana", deactivatedAt: new Date("2026-01-01") };

    const rows = await listUsers({ includeInactive: true }, async () => [...ROWS, inactive]);

    expect(rows).toEqual([ROWS[0], inactive]);
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
