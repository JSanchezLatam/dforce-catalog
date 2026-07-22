import { describe, expect, it } from "vitest";

import { isSessionActive, requireSession } from "./session";

const HOUR_MS = 60 * 60 * 1000;

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
