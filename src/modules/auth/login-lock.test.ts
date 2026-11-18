import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";
import { IP_LOCK, lockedUntil, loginKey, USER_LOCK } from "./login-lock";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const failure = (minutes: number) => ({ at: minutesAgo(minutes), outcome: "bad_password" as const });

describe("lockedUntil", () => {
  it("locks on the fifth failure inside 15 minutes, for 15 minutes from that failure", () => {
    const attempts = [failure(10), failure(8), failure(6), failure(4), failure(2)];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toEqual(new Date(minutesAgo(2).getTime() + 15 * 60_000));
  });

  it("does not lock on four failures", () => {
    expect(lockedUntil([failure(4), failure(3), failure(2), failure(1)], NOW, USER_LOCK)).toBeNull();
  });

  it("does not lock when the failures are spread over more than 15 minutes", () => {
    const attempts = [failure(29), failure(22), failure(14), failure(7), failure(1)];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toBeNull();
  });

  it("releases the lock once its 15 minutes have passed", () => {
    const attempts = [failure(21), failure(20), failure(19), failure(18), failure(16)];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toBeNull();
  });

  it("does not extend the lock with attempts refused while locked", () => {
    const attempts = [
      failure(10),
      failure(9),
      failure(8),
      failure(7),
      failure(6),
      { at: minutesAgo(1), outcome: "locked" as const },
    ];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toEqual(new Date(minutesAgo(6).getTime() + 15 * 60_000));
  });

  it.each(["success", "unlocked"] as const)("forgets earlier failures after %s", (outcome) => {
    const attempts = [failure(9), failure(8), failure(7), failure(6), failure(5), { at: minutesAgo(4), outcome }];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toBeNull();
  });

  it("locks an IP on the twentieth failure, and a success does not clear it", () => {
    const attempts = [
      ...Array.from({ length: 10 }, (_, i) => failure(14 - i * 0.1)),
      { at: minutesAgo(12), outcome: "success" as const },
      ...Array.from({ length: 10 }, (_, i) => failure(10 - i * 0.1)),
    ];

    expect(lockedUntil(attempts, NOW, IP_LOCK)).not.toBeNull();
    expect(lockedUntil(attempts.slice(1), NOW, IP_LOCK)).toBeNull();
  });
});

describe("loginKey", () => {
  // Usernames are case-sensitive: `Ana` and `ana` can be two accounts with separate counters.
  it("keeps the login exactly as typed", () => {
    expect(loginKey(" MRodriguez")).toBe(" MRodriguez");
  });

  it("bounds the stored length", () => {
    expect(loginKey("a".repeat(500))).toHaveLength(150);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "192.168.1.23, 10.0.0.1" }))).toBe("192.168.1.23");
  });

  it("removes the IPv4-mapped prefix", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "::ffff:192.168.1.23" }))).toBe("192.168.1.23");
  });

  it.each([[{}], [{ "x-forwarded-for": "no-es-una-ip" }]])("returns null without a valid address: %j", (headers) => {
    expect(clientIp(new Headers(headers))).toBeNull();
  });
});
