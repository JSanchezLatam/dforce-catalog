/**
 * Real-Postgres coverage for "Registro de accesos" (S10): its value is the
 * join that hides an unknown login's typed text, and its WHERE.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { ilike, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAccessLog, listAccessLog } from "@/modules/auth/access-log-queries";
import { db } from "@/shared/db/client";
import { loginAttempts, users } from "@/shared/db/schema";

const PREFIX = `e2e-log-${Date.now()}`;
const KNOWN = `${PREFIX}-ana`;
// What someone typed into the username field: it may be a password.
const TYPED = `${PREFIX}-Clave.Secreta9`;
// A clock far from every other test's rows, so the window holds only these.
const NOW = new Date("2101-01-15T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const userId = randomUUID();
const page = { offset: 0, limit: 50 };

describe("Registro de accesos against a real database", () => {
  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    await db.insert(users).values({ id: userId, username: KNOWN, passwordHash: "x", role: "tecnico" });
    await db.insert(loginAttempts).values([
      { id: randomUUID(), at: daysAgo(0.1), username: KNOWN, userId, ip: "192.168.1.23", outcome: "success" },
      { id: randomUUID(), at: daysAgo(0.2), username: KNOWN, userId, ip: "192.168.1.23", outcome: "bad_password" },
      // Refused rows carry no user_id even for a real user.
      { id: randomUUID(), at: daysAgo(0.3), username: KNOWN, userId: null, ip: "192.168.1.23", outcome: "locked" },
      { id: randomUUID(), at: daysAgo(0.4), username: TYPED, userId: null, ip: "45.12.0.9", outcome: "unknown_user" },
      { id: randomUUID(), at: daysAgo(10), username: KNOWN, userId, ip: null, outcome: "unlocked", actorId: userId },
    ]);
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, [userId]));
    await db.$client.end();
  });

  it("lists the period newest first, naming a real user even on a row without user_id", async () => {
    const rows = await listAccessLog({ days: 7 }, page, NOW);

    expect(rows.map((r) => [r.username, r.outcome])).toEqual([
      [KNOWN, "success"],
      [KNOWN, "bad_password"],
      [KNOWN, "locked"],
      [null, "unknown_user"],
    ]);
    expect(await countAccessLog({ days: 7 }, NOW)).toBe(4);
  });

  it("never returns the text typed for an unknown login", async () => {
    const rows = await listAccessLog({ days: 90 }, page, NOW);

    expect(JSON.stringify(rows)).not.toContain("Clave.Secreta9");
  });

  it("filters by user, result and period", async () => {
    expect((await listAccessLog({ days: 7, result: "failed" }, page, NOW)).map((r) => r.outcome)).toEqual([
      "bad_password",
      "unknown_user",
    ]);
    expect((await listAccessLog({ days: 30, user: KNOWN, result: "unlocked" }, page, NOW)).map((r) => r.outcome)).toEqual([
      "unlocked",
    ]);
    expect((await listAccessLog({ days: 30, result: "unlocked" }, page, NOW))[0].actor).toBe(KNOWN);
    expect((await listAccessLog({ days: 7, result: "success" }, page, NOW))[0].actor).toBeNull();
    expect(await countAccessLog({ days: 30, user: KNOWN }, NOW)).toBe(4);
  });

  // Filtering by the typed text would confirm a guess of it (L16): only a real login matches.
  it("matches the user filter only against real logins", async () => {
    expect(await listAccessLog({ days: 1, user: TYPED }, page, NOW)).toEqual([]);
    expect(await countAccessLog({ days: 1, user: TYPED }, NOW)).toBe(0);
  });

  it("pages with limit and offset", async () => {
    const second = await listAccessLog({ days: 7 }, { offset: 1, limit: 2 }, NOW);

    expect(second.map((r) => r.outcome)).toEqual(["bad_password", "locked"]);
  });
});
