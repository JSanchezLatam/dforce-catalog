import { describe, expect, it, vi } from "vitest";

import { hashDeviceToken, trustDevice } from "./trusted-device";

describe("trusted device tokens", () => {
  it("hashes with SHA-256 in hex", () => {
    // sha256("abc"), FIPS 180-2 Appendix B.1.
    expect(hashDeviceToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns a 32-byte base64url token expiring in 30 days and stores only its hash", async () => {
    const values = vi.fn(async () => undefined);
    const executor = { insert: vi.fn(() => ({ values })) } as never;
    const now = new Date("2026-11-20T12:00:00Z");

    const { token, expiresAt } = await trustDevice("user-1", executor, now);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(expiresAt).toEqual(new Date("2026-12-20T12:00:00Z"));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", tokenHash: hashDeviceToken(token), expiresAt, createdAt: now }),
    );
    expect(JSON.stringify(values.mock.calls)).not.toContain(token);
  });

  it("makes a different token each time", async () => {
    const executor = { insert: () => ({ values: async () => undefined }) } as never;
    const a = await trustDevice("user-1", executor);
    const b = await trustDevice("user-1", executor);
    expect(a.token).not.toBe(b.token);
  });
});
