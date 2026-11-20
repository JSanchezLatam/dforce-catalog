/**
 * Real-Postgres coverage for the second step of 2FA (T7): the advisory locks,
 * the single-use UPDATEs checked by row count, the `password_ok` row turning
 * into a success, and the session swap.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { and, eq, ilike, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `env` reads process.env when its module loads, and static imports hoist above any plain statement.
vi.hoisted(() => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
    "base64",
  );
});

import { POST as LOGIN } from "@/app/api/login/route";
import { POST as VERIFY } from "@/app/api/two-factor/verify/route";
import { userLocks } from "@/modules/auth/login-attempts";
import { hashPassword } from "@/modules/auth/password";
import { generateRecoveryCodes, hashRecoveryCode } from "@/modules/auth/recovery-codes";
import { sealSecret, totpKey } from "@/modules/auth/secret-box";
import { issueSession, SESSION_COOKIE } from "@/modules/auth/session";
import { totpAt } from "@/modules/auth/totp";
import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";

const PREFIX = `e2e-2fv-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.79.0.${++ipCounter}`;

const rightCode = () => totpAt(SECRET, new Date());
/** One digit off the current code: never the code of an adjacent step in practice. */
const wrongCode = () => {
  const code = rightCode();
  return `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
};

async function createLogin(name: string, twoFactor = true): Promise<{ id: string; username: string }> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role: "administrador" });
  made.push(id);
  if (twoFactor) {
    await db.insert(userTotp).values({ userId: id, secretSealed: sealSecret(SECRET, id, totpKey()), enabledAt: new Date() });
  }
  return { id, username };
}

async function pendingToken(username: string, ip = freshIp()): Promise<string> {
  const response = await LOGIN(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  return response.cookies.get(SESSION_COOKIE)!.value;
}

const verify = (token: string, body: { code?: string; recoveryCode?: string }, ip = freshIp(), headers = {}) =>
  VERIFY(
    new NextRequest("http://localhost/api/two-factor/verify", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "x-forwarded-for": ip, ...headers },
      body: JSON.stringify(body),
    }),
  );

const attemptsFor = (username: string) => db.select().from(loginAttempts).where(eq(loginAttempts.username, username));
const outcomesFor = async (username: string) => (await attemptsFor(username)).map((row) => row.outcome).sort();
const sessionRow = async (token: string) => (await db.select().from(sessions).where(eq(sessions.id, token)))[0];

describe("2FA second step against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("swaps a right code for a full session and turns the password_ok row into a success with 2FA, stamped now", async () => {
    const { username } = await createLogin("right");
    const pending = await pendingToken(username);
    const [passwordOk] = await attemptsFor(username);
    const before = Date.now();

    const response = await verify(pending, { code: rightCode() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/inventory" });
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie.value).not.toBe(pending);
    expect(cookie.httpOnly).toBe(true);
    const full = await sessionRow(cookie.value);
    expect(full).toMatchObject({ pending: null, revokedAt: null });
    expect(full.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60_000);
    expect((await sessionRow(pending)).revokedAt).toBeInstanceOf(Date);

    const rows = await attemptsFor(username);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: passwordOk.id, outcome: "success", secondFactor: "totp" });
    expect(rows[0].at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("answers a wrong code with 401 and a bad_code row naming the user and IP", async () => {
    const { id, username } = await createLogin("wrong");
    const pending = await pendingToken(username);
    const ip = freshIp();

    const response = await verify(pending, { code: wrongCode() }, ip);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_code" });
    const [bad] = await db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.username, username), eq(loginAttempts.outcome, "bad_code")));
    expect(bad).toMatchObject({ userId: id, ip });
    expect((await sessionRow(pending)).revokedAt).toBeNull();
  });

  // L29: the success is stamped after the bad codes, so they fall before the reset.
  it("leaves the user lock counter empty after two wrong codes and a right one", async () => {
    const { username } = await createLogin("reset");
    const pending = await pendingToken(username);

    for (let i = 0; i < 2; i += 1) expect((await verify(pending, { code: wrongCode() })).status).toBe(401);
    expect((await verify(pending, { code: rightCode() })).status).toBe(200);

    // Four more failures would lock if the two bad codes still counted.
    for (let i = 0; i < 4; i += 1) {
      const again = await pendingToken(username);
      expect((await verify(again, { code: wrongCode() })).status).toBe(401);
    }
    expect((await userLocks([username])).get(username)).toBeUndefined();
  });

  it("locks after five wrong codes, then refuses even the right code with 429", async () => {
    const { username } = await createLogin("lock");
    const pending = await pendingToken(username);

    for (let i = 0; i < 5; i += 1) expect((await verify(pending, { code: wrongCode() })).status).toBe(401);
    const locked = await verify(pending, { code: rightCode() });

    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "locked" });
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await sessionRow(pending)).revokedAt).toBeNull();
    expect(await outcomesFor(username)).toEqual([...Array(5).fill("bad_code"), "password_ok"]);
  });

  it("refuses while the IP is locked", async () => {
    const { username } = await createLogin("ip");
    const pending = await pendingToken(username);
    const ip = freshIp();
    await db.insert(loginAttempts).values(
      Array.from({ length: 20 }, () => ({
        id: randomUUID(),
        at: new Date(),
        username: `${PREFIX}-ip-guess`,
        ip,
        outcome: "bad_password" as const,
      })),
    );

    expect((await verify(pending, { code: rightCode() }, ip)).status).toBe(429);
    expect((await sessionRow(pending)).revokedAt).toBeNull();
  });

  it("accepts a code once: the same code on a second pending session is refused", async () => {
    const { username } = await createLogin("replay");
    const first = await pendingToken(username);
    const second = await pendingToken(username);
    const code = rightCode();

    expect((await verify(first, { code })).status).toBe(200);
    expect((await verify(second, { code })).status).toBe(401);
  });

  it("accepts a code once under concurrency: exactly one of two parallel uses wins", async () => {
    const { username } = await createLogin("race");
    const tokens = [await pendingToken(username), await pendingToken(username)];
    const code = rightCode();

    const statuses = (await Promise.all(tokens.map((token) => verify(token, { code })))).map((r) => r.status).sort();

    expect(statuses).toEqual([200, 401]);
  });

  it("accepts a recovery code once and marks it used", async () => {
    const { id, username } = await createLogin("recovery");
    const [code, other] = generateRecoveryCodes(2);
    await db.insert(recoveryCodes).values(
      [code, other].map((value) => ({ id: randomUUID(), userId: id, codeHash: hashRecoveryCode(value, totpKey()) })),
    );
    const first = await pendingToken(username);
    const second = await pendingToken(username);

    const response = await verify(first, { recoveryCode: code.toLowerCase() });
    expect(response.status).toBe(200);
    const rows = await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id));
    expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
    expect(rows.find((row) => row.codeHash === hashRecoveryCode(code, totpKey()))!.usedAt).toBeInstanceOf(Date);
    expect((await attemptsFor(username)).find((row) => row.outcome === "success")!.secondFactor).toBe("recovery");

    const again = await verify(second, { recoveryCode: code });
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: "invalid_code" });
  });

  // A key that no longer opens the secret is an install fault: it must not count toward a lock.
  it("answers 503 and writes no bad_code when the key does not open the user's secret", async () => {
    const { id, username } = await createLogin("rekeyed");
    await db
      .update(userTotp)
      .set({ secretSealed: sealSecret(SECRET, id, Buffer.alloc(32, 7)) })
      .where(eq(userTotp.userId, id));
    const pending = await pendingToken(username);

    const response = await verify(pending, { code: rightCode() });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(await outcomesFor(username)).toEqual(["password_ok"]);
  });

  it("answers no_pending_session for an expired pending session", async () => {
    const { username } = await createLogin("expired");
    const pending = await pendingToken(username);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, pending));

    const response = await verify(pending, { code: rightCode() });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
  });

  // The proxy forwards identity on this exempt path, so the route must read the state from the database.
  it("answers no_pending_session for a full session, whatever headers it carries", async () => {
    const { id } = await createLogin("full");
    const { token } = await issueSession(id, "administrador");

    const response = await verify(token, { code: rightCode() }, freshIp(), {
      "x-user-id": id,
      "x-user-role": "administrador",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "no_pending_session" });
    expect((await sessionRow(token)).revokedAt).toBeNull();
  });
});
