import { timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearedCookie, passwordMatches, requireSupport, sessionCookie, signSession, verifySession } from "./session";

// A spy that still calls through: the only way a unit test can see HOW a compare is done.
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});

let jar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined) }),
}));

const SECRET = "s3cret-for-tests";
const NOW = 1_800_000_000;
const attrs = (header: string) => header.split("; ").slice(1);

beforeEach(() => {
  jar = {};
  vi.mocked(timingSafeEqual).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("signSession / verifySession", () => {
  it("round-trips a value that expires in 12 hours", () => {
    const value = signSession(SECRET, NOW);
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(value.split(".")[0]).toBe(String(NOW + 43200));
    expect(verifySession(value, SECRET, NOW)).toBe(true);
    expect(verifySession(value, SECRET, NOW + 43199)).toBe(true);
  });

  it("rejects an expired value, and one expiring exactly now", () => {
    const value = signSession(SECRET, NOW);
    expect(verifySession(value, SECRET, NOW + 43200)).toBe(false);
    expect(verifySession(value, SECRET, NOW + 43201)).toBe(false);
  });

  it("rejects an altered signature", () => {
    const value = signSession(SECRET, NOW);
    const last = value.endsWith("0") ? "1" : "0";
    expect(verifySession(value.slice(0, -1) + last, SECRET, NOW)).toBe(false);
  });

  it("rejects an extended expiry that keeps the old signature", () => {
    const [exp, sig] = signSession(SECRET, NOW).split(".");
    expect(verifySession(`${Number(exp) + 99999}.${sig}`, SECRET, NOW)).toBe(false);
  });

  it("rejects a value signed with another secret", () => {
    expect(verifySession(signSession("other", NOW), SECRET, NOW)).toBe(false);
  });

  it.each([undefined, "", "garbage", "123.abc", "x.".padEnd(66, "a"), `${NOW + 5}.${"A".repeat(64)}`, `${NOW + 5}.${"a".repeat(65)}`])(
    "rejects the malformed value %j without throwing",
    (value) => {
      expect(verifySession(value, SECRET, NOW)).toBe(false);
    },
  );

  it("fails closed when the secret is unset or empty, even for a value signed with the empty key", () => {
    const value = signSession(SECRET, NOW);
    expect(verifySession(value, undefined, NOW)).toBe(false);
    expect(verifySession(value, "", NOW)).toBe(false);
    expect(verifySession(signSession("", NOW), "", NOW)).toBe(false);
  });

  it("compares the signature with timingSafeEqual", () => {
    verifySession(signSession(SECRET, NOW), SECRET, NOW);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});

describe("passwordMatches", () => {
  it("accepts the exact password only", () => {
    expect(passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(passwordMatches("correct horsf", "correct horse")).toBe(false);
    expect(passwordMatches("", "correct horse")).toBe(false);
  });

  it("compares equal-length digests with timingSafeEqual, whatever the password lengths", () => {
    expect(passwordMatches("x", "a-much-longer-expected-password")).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const [a, b] = vi.mocked(timingSafeEqual).mock.calls[0] as [Buffer, Buffer];
    expect([a.length, b.length]).toEqual([32, 32]);
  });

  it("fails closed when no password is configured, even for an empty guess", () => {
    expect(passwordMatches("", undefined)).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches("anything", undefined)).toBe(false);
  });
});

describe("cookies", () => {
  it("sets the session cookie httpOnly, secure, sameSite=strict, 12 h, path /", () => {
    const header = sessionCookie("v.alue");
    expect(header.startsWith("support_session=v.alue; ")).toBe(true);
    expect(attrs(header)).toEqual(["Max-Age=43200", "Path=/", "HttpOnly", "Secure", "SameSite=Strict"]);
  });

  it("clears it with the same attributes and Max-Age=0", () => {
    const header = clearedCookie();
    expect(header.startsWith("support_session=; ")).toBe(true);
    expect(attrs(header)).toEqual(["Max-Age=0", "Path=/", "HttpOnly", "Secure", "SameSite=Strict"]);
  });
});

describe("requireSupport", () => {
  it("is true for a valid cookie", async () => {
    vi.stubEnv("SUPPORT_SESSION_SECRET", SECRET);
    jar.support_session = signSession(SECRET);
    expect(await requireSupport()).toBe(true);
  });

  it("is false with no cookie, an expired one, a forged one, or the secret unset", async () => {
    vi.stubEnv("SUPPORT_SESSION_SECRET", SECRET);
    expect(await requireSupport()).toBe(false);
    jar.support_session = signSession(SECRET, Math.floor(Date.now() / 1000) - 50000);
    expect(await requireSupport()).toBe(false);
    jar.support_session = signSession("not-the-secret");
    expect(await requireSupport()).toBe(false);
    jar.support_session = signSession(SECRET);
    vi.stubEnv("SUPPORT_SESSION_SECRET", "");
    expect(await requireSupport()).toBe(false);
  });
});
