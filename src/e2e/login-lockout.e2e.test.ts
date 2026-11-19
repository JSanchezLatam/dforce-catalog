/**
 * Real-Postgres coverage for the login locks: the value of this feature is in
 * its queries, its advisory locks and the row each attempt leaves behind.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/login/route";
import { POST as UNLOCK } from "@/app/api/users/[id]/unlock/route";
import { userLocks } from "@/modules/auth/login-attempts";
import { UNTIL_UNLOCKED } from "@/modules/auth/login-lock";
import { hashPassword } from "@/modules/auth/password";
import { db } from "@/shared/db/client";
import { loginAttempts, users } from "@/shared/db/schema";

const PREFIX = `e2e-lock-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.77.0.${++ipCounter}`;

const login = (username: string, password: string, ip: string) =>
  POST(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ username, password }),
    }),
  );

async function createLogin(name: string): Promise<string> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role: "tecnico" });
  made.push(id);
  return username;
}

const rowsFor = (username: string) =>
  db.select().from(loginAttempts).where(inArray(loginAttempts.username, [username]));

describe("login locks against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("locks after five failures, even for the correct password, and logs each attempt", async () => {
    const username = await createLogin("five");
    const ip = freshIp();

    for (let i = 0; i < 5; i += 1) expect((await login(username, "incorrecta", ip)).status).toBe(401);
    const locked = await login(username, PASSWORD, ip);

    expect(locked.status).toBe(429);
    expect(locked.cookies.get("session")).toBeUndefined();
    const outcomes = (await rowsFor(username)).map((row) => row.outcome).sort();
    expect(outcomes).toEqual(["bad_password", "bad_password", "bad_password", "bad_password", "bad_password", "locked"]);
  });

  it("opens a locked login at once when an administrator unlocks it", async () => {
    const username = await createLogin("unlock");
    const ip = freshIp();
    const [{ id }] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    for (let i = 0; i < 5; i += 1) await login(username, "incorrecta", ip);
    expect((await userLocks([username])).get(username)).toBeInstanceOf(Date);

    const unlocked = await UNLOCK(
      new NextRequest(`http://localhost/api/users/${id}/unlock`, {
        method: "POST",
        headers: { "x-user-id": made[0], "x-user-role": "administrador", "x-forwarded-for": "10.77.9.9" },
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(unlocked.status).toBe(200);
    expect((await userLocks([username])).has(username)).toBe(false);
    const row = (await rowsFor(username)).find((attempt) => attempt.outcome === "unlocked");
    expect(row).toMatchObject({ userId: id, ip: "10.77.9.9" });
    expect((await login(username, PASSWORD, ip)).status).toBe(200);
  });

  describe("escalation (S6: 15 min, 1 hora, después admin)", () => {
    const DAY = 24 * 60 * 60_000;
    // Five failures a minute apart, `daysAgo` days back: one past lock, already over.
    const pastLock = (username: string, daysAgo: number) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: randomUUID(),
        at: new Date(Date.now() - daysAgo * DAY + i * 60_000),
        username,
        ip: "10.77.8.8",
        outcome: "bad_password" as const,
      }));

    it("locks until an administrator unlocks the third time, however old the earlier locks", async () => {
      const username = await createLogin("third");
      const ip = freshIp();
      await db.insert(loginAttempts).values([
        { id: randomUUID(), at: new Date(Date.now() - 4 * DAY), username, ip, outcome: "success" },
        ...pastLock(username, 3),
        ...pastLock(username, 2),
      ]);

      for (let i = 0; i < 5; i += 1) expect((await login(username, "incorrecta", ip)).status).toBe(401);
      const refused = await login(username, PASSWORD, ip);

      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBeNull();
      expect((await userLocks([username])).get(username)).toBe(UNTIL_UNLOCKED);
    });

    it("starts over after a successful login between the locks", async () => {
      const username = await createLogin("restart");
      const ip = freshIp();
      await db.insert(loginAttempts).values([
        ...pastLock(username, 3),
        ...pastLock(username, 2),
        { id: randomUUID(), at: new Date(Date.now() - DAY), username, ip, outcome: "success" },
      ]);

      for (let i = 0; i < 5; i += 1) await login(username, "incorrecta", ip);
      const until = (await userLocks([username])).get(username);

      expect(until).toBeInstanceOf(Date);
      expect(until!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    });
  });

  it("does not let parallel guesses pass the limit", async () => {
    const username = await createLogin("parallel");
    const ip = freshIp();

    const statuses = (await Promise.all(Array.from({ length: 8 }, () => login(username, "incorrecta", ip)))).map(
      (response) => response.status,
    );

    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
  });

  it("keeps accounts that differ only by case on separate counters", async () => {
    const username = await createLogin("case");
    const ip = freshIp();

    for (let i = 0; i < 5; i += 1) await login(username.toUpperCase(), "incorrecta", ip);

    expect((await login(username.toUpperCase(), PASSWORD, ip)).status).toBe(429);
    expect((await login(username, PASSWORD, ip)).status).toBe(200);
  });

  it("clears the failure count after a successful login and records the user", async () => {
    const username = await createLogin("reset");
    const ip = freshIp();

    for (let i = 0; i < 4; i += 1) await login(username, "incorrecta", ip);
    expect((await login(username, PASSWORD, ip)).status).toBe(200);
    expect((await login(username, "incorrecta", ip)).status).toBe(401);
    expect((await login(username, PASSWORD, ip)).status).toBe(200);

    const success = (await rowsFor(username)).filter((row) => row.outcome === "success");
    expect(success).toHaveLength(2);
    expect(success[0].userId).toBe(made[made.length - 1]);
    expect(success[0].ip).toBe(ip);
  });

  it("locks unknown logins the same way and records them", async () => {
    const username = `${PREFIX}-nobody`;
    const ip = freshIp();

    for (let i = 0; i < 5; i += 1) expect((await login(username, "incorrecta", ip)).status).toBe(401);

    expect((await login(username, "incorrecta", ip)).status).toBe(429);
    expect((await rowsFor(username)).filter((row) => row.outcome === "unknown_user")).toHaveLength(5);
  });

  it("locks an address after twenty failures across different logins", async () => {
    const ip = freshIp();

    for (let i = 0; i < 20; i += 1) {
      expect((await login(`${PREFIX}-ip-${i}`, "incorrecta", ip)).status).toBe(401);
    }

    expect((await login(`${PREFIX}-ip-next`, "incorrecta", ip)).status).toBe(429);
    expect((await login(`${PREFIX}-ip-next`, "incorrecta", freshIp())).status).toBe(401);
  });
});
