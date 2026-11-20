import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";
import { IP_LOCK, lockedUntil, loginKey, UNTIL_UNLOCKED, USER_LOCK } from "./login-lock";

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

  // A right password still owing its code must not reset the count (L28), or
  // password and code guesses could alternate forever.
  it("neither counts nor resets on password_ok: four failures and a password_ok do not lock, a fifth failure does", () => {
    const attempts = [failure(10), failure(9), failure(8), failure(7), { at: minutesAgo(6), outcome: "password_ok" as const }];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toBeNull();
    expect(lockedUntil([...attempts, failure(5)], NOW, USER_LOCK)).toEqual(new Date(minutesAgo(5).getTime() + 15 * 60_000));
  });

  it("counts a wrong second-step code toward the lock", () => {
    const code = (minutes: number) => ({ at: minutesAgo(minutes), outcome: "bad_code" as const });
    const attempts = [failure(10), code(9), code(8), code(7), code(6)];

    expect(lockedUntil(attempts, NOW, USER_LOCK)).toEqual(new Date(minutesAgo(6).getTime() + 15 * 60_000));
  });

  describe("escalation (S6: 15 min, 1 hora, después admin)", () => {
    // Five failures one minute apart, the last one `minutes` ago: one lock each.
    const run = (minutes: number) => [4, 3, 2, 1, 0].map((offset) => failure(minutes + offset));

    it("locks for one hour the second time in a row", () => {
      const attempts = [...run(100), ...run(10)];

      expect(lockedUntil(attempts, NOW, USER_LOCK)).toEqual(new Date(minutesAgo(10).getTime() + 60 * 60_000));
    });

    it("locks until an administrator unlocks the third time, however long ago", () => {
      const attempts = [...run(5000), ...run(4000), ...run(3000)];

      expect(lockedUntil(attempts, NOW, USER_LOCK)).toBe(UNTIL_UNLOCKED);
    });

    it.each(["success", "unlocked"] as const)("starts the count over after %s", (outcome) => {
      const attempts = [...run(5000), ...run(4000), { at: minutesAgo(3000), outcome }, ...run(10)];

      expect(lockedUntil(attempts, NOW, USER_LOCK)).toEqual(new Date(minutesAgo(10).getTime() + 15 * 60_000));
    });

    it("keeps an IP lock at 15 minutes however often it repeats", () => {
      const ipRun = (minutes: number) => Array.from({ length: 20 }, (_, i) => failure(minutes + i * 0.1));
      const attempts = [...ipRun(200), ...ipRun(100), ...ipRun(10)];

      expect(lockedUntil(attempts, NOW, IP_LOCK)).toEqual(new Date(minutesAgo(10).getTime() + 15 * 60_000));
    });
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
