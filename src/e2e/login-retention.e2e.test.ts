/**
 * Real-Postgres coverage for the 90-day retention of login attempts (S10):
 * old rows go, except the ones a lock is still computed from.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { purgeOldLoginAttempts, userLocks } from "@/modules/auth/login-attempts";
import { UNTIL_UNLOCKED, type LoginOutcome } from "@/modules/auth/login-lock";
import { db } from "@/shared/db/client";
import { loginAttempts, users } from "@/shared/db/schema";

const PREFIX = `e2e-retention-${Date.now()}`;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number, minutes = 0) => new Date(NOW - days * DAY + minutes * 60_000);

const row = (username: string, outcome: LoginOutcome, when: Date) => ({
  id: randomUUID(),
  at: when,
  username: `${PREFIX}-${username}`,
  ip: null,
  outcome,
});
// Five failures one minute apart: one lock.
const run = (username: string, days: number) =>
  [0, 1, 2, 3, 4].map((minute) => row(username, "bad_password", at(days, minute)));

const left = async (username: string) =>
  (
    await db
      .select({ outcome: loginAttempts.outcome, at: loginAttempts.at })
      .from(loginAttempts)
      .where(eq(loginAttempts.username, `${PREFIX}-${username}`))
      .orderBy(loginAttempts.at)
  ).map((r) => `${r.outcome}@${Math.round((NOW - r.at.getTime()) / DAY)}`);

// Real logins; "ghost" matches no user.
const REAL = ["reset", "refused", "forever"];
const ids = REAL.map(() => randomUUID());

describe("login attempt retention against a real database", () => {
  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    await db
      .insert(users)
      .values(REAL.map((name, i) => ({ id: ids[i], username: `${PREFIX}-${name}`, passwordHash: "x", role: "tecnico" as const })));
    await db.insert(loginAttempts).values([
      row("reset", "bad_password", at(120)),
      row("reset", "success", at(110)),
      row("reset", "bad_password", at(100)),
      row("refused", "locked", at(100)),
      row("refused", "bad_password", at(100)),
      row("refused", "locked", at(1)),
      ...run("forever", 200),
      ...run("forever", 150),
      ...run("forever", 100),
      row("ghost", "unknown_user", at(100)),
      ...run("ghost", 95),
      row("ghost", "unknown_user", at(1)),
    ]);
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, ids));
    await db.$client.end();
  });

  it("deletes old rows from before the last reset, and keeps the reset and what follows", async () => {
    await purgeOldLoginAttempts();

    expect(await left("reset")).toEqual(["success@110", "bad_password@100"]);
  });

  it("deletes old refused attempts, which no lock counts, and keeps recent ones", async () => {
    await purgeOldLoginAttempts();

    expect(await left("refused")).toEqual(["bad_password@100", "locked@1"]);
  });

  // Owner, 2026-11-20: "Borrarlos a los 90 días". What was typed may be a password.
  it("deletes every old row of a login that matches no user, even one it keeps locked", async () => {
    await purgeOldLoginAttempts();

    expect(await left("ghost")).toEqual(["unknown_user@1"]);
  });

  it("keeps every row of a lock that lasts until an unlock, however old", async () => {
    const forever = `${PREFIX}-forever`;
    expect((await userLocks([forever])).get(forever)).toBe(UNTIL_UNLOCKED);

    await purgeOldLoginAttempts();

    expect(await left("forever")).toHaveLength(15);
    expect((await userLocks([forever])).get(forever)).toBe(UNTIL_UNLOCKED);
  });
});
