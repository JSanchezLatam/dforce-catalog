import { describe, expect, it, vi } from "vitest";

import { isSessionActive, isUserActive, requireSession, revokeOtherSessions, validateSession } from "./session";

const HOUR_MS = 60 * 60 * 1000;

type FakeRow = {
  userId: string;
  role: "administrador" | "tecnico";
  expiresAt: Date;
  revokedAt: Date | null;
  deactivatedAt: Date | null;
  mustChangePassword: boolean;
};

function activeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    userId: "user-1",
    role: "administrador",
    expiresAt: new Date(Date.now() + HOUR_MS),
    revokedAt: null,
    deactivatedAt: null,
    mustChangePassword: false,
    ...overrides,
  };
}

describe("isSessionActive() — expired/revoked session detection (R9.3)", () => {
  it("is active when not expired and not revoked", () => {
    expect(
      isSessionActive({ expiresAt: new Date(Date.now() + HOUR_MS), revokedAt: null }),
    ).toBe(true);
  });

  it("is inactive once past expiresAt", () => {
    expect(
      isSessionActive({ expiresAt: new Date(Date.now() - HOUR_MS), revokedAt: null }),
    ).toBe(false);
  });

  it("is inactive once revoked, even if not yet expired", () => {
    expect(
      isSessionActive({ expiresAt: new Date(Date.now() + HOUR_MS), revokedAt: new Date() }),
    ).toBe(false);
  });
});

describe("requireSession() — route-handler seam", () => {
  it("reads the identity middleware.ts forwarded as headers", () => {
    const request = new Request("http://localhost/inventory", {
      headers: { "x-user-id": "user-1", "x-user-role": "administrador" },
    });
    expect(requireSession(request)).toEqual({ id: "user-1", role: "administrador" });
  });

  it("throws when middleware.ts did not validate the request (missing headers)", () => {
    const request = new Request("http://localhost/inventory");
    expect(() => requireSession(request)).toThrow();
  });
});

describe("isUserActive() — deactivation predicate (design.md Decision 7)", () => {
  it("is active when deactivatedAt is null", () => {
    expect(isUserActive({ deactivatedAt: null })).toBe(true);
  });

  it("is inactive once deactivatedAt is set", () => {
    expect(isUserActive({ deactivatedAt: new Date() })).toBe(false);
  });
});

describe("validateSession() — DB-free via injected queryFn", () => {
  it("returns the session user for an active session belonging to an active user", async () => {
    const row = activeRow();
    const queryFn = vi.fn().mockResolvedValue(row);

    const result = await validateSession("token-1", queryFn);

    expect(queryFn).toHaveBeenCalledWith("token-1");
    expect(result).toEqual({ id: "user-1", role: "administrador", mustChangePassword: false });
  });

  it("returns null when no row is found (unknown token)", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    expect(await validateSession("missing", queryFn)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const row = activeRow({ expiresAt: new Date(Date.now() - HOUR_MS) });
    const queryFn = vi.fn().mockResolvedValue(row);
    expect(await validateSession("token-1", queryFn)).toBeNull();
  });

  it("returns null for a revoked session", async () => {
    const row = activeRow({ revokedAt: new Date() });
    const queryFn = vi.fn().mockResolvedValue(row);
    expect(await validateSession("token-1", queryFn)).toBeNull();
  });

  it("returns null for a deactivated user's otherwise-valid session — even an administrador", async () => {
    // Pins the gate-precedence + role-independence requirement (spec
    // `user-management` "Deactivation Denies Access Regardless of Role"):
    // the row below has an unexpired, non-revoked session AND an
    // administrador role — the matrix would grant this role every action —
    // yet the session must still come back null because the account itself
    // is deactivated. The block lives here, never in policy.ts's can().
    const row = activeRow({ role: "administrador", deactivatedAt: new Date() });
    const queryFn = vi.fn().mockResolvedValue(row);

    expect(await validateSession("token-1", queryFn)).toBeNull();
  });

  it("surfaces mustChangePassword on the returned session user (WU3 will act on it; this unit only carries it)", async () => {
    const row = activeRow({ mustChangePassword: true });
    const queryFn = vi.fn().mockResolvedValue(row);

    const result = await validateSession("token-1", queryFn);

    expect(result?.mustChangePassword).toBe(true);
  });
});

describe("revokeOtherSessions()", () => {
  it("revokes all sessions except the current one when keepTokenId is provided", async () => {
    const fn = vi.fn();
    await revokeOtherSessions("user-1", "current-token", fn);
    expect(fn).toHaveBeenCalledWith("user-1", "current-token");
  });

  it("revokes all sessions when keepTokenId is null", async () => {
    const fn = vi.fn();
    await revokeOtherSessions("user-1", null, fn);
    expect(fn).toHaveBeenCalledWith("user-1", null);
  });
});
