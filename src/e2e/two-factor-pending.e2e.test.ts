/**
 * Real-Postgres coverage for the password step of 2FA (T6): the 2FA lookup's
 * WHERE, the pending session row, the attempt it leaves, and the proxy gate on
 * a real session.
 */
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/login/route";
import { userLocks } from "@/modules/auth/login-attempts";
import { hashPassword } from "@/modules/auth/password";
import { sealSecret } from "@/modules/auth/secret-box";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { db } from "@/shared/db/client";
import { loginAttempts, sessions, users, userTotp } from "@/shared/db/schema";
import { handleProxy } from "@/proxy";

const PREFIX = `e2e-2fa-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const TEN_MINUTES = 10 * 60_000;
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.78.0.${++ipCounter}`;

const login = (username: string, password: string, ip = freshIp()) =>
  POST(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ username, password }),
    }),
  );

/** `twoFactor`: "enabled" seeds a finished enrolment, "enrolling" one with `enabled_at` still null. */
async function createLogin(name: string, twoFactor: "enabled" | "enrolling" | "none"): Promise<string> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role: "administrador" });
  made.push(id);
  if (twoFactor !== "none") {
    // Nothing decrypts the secret in T6; it only has to be a real sealed value.
    const secretSealed = sealSecret("JBSWY3DPEHPK3PXP", id, randomBytes(32));
    await db.insert(userTotp).values({ userId: id, secretSealed, enabledAt: twoFactor === "enabled" ? new Date() : null });
  }
  return username;
}

const outcomesFor = async (username: string) =>
  (await db.select().from(loginAttempts).where(eq(loginAttempts.username, username))).map((row) => row.outcome);

const sessionRow = async (token: string) => (await db.select().from(sessions).where(eq(sessions.id, token)))[0];

const withCookie = (path: string, token: string) =>
  new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

describe("2FA password step against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("answers a 2FA user's right password with a pending verify session of ten minutes at most", async () => {
    const username = await createLogin("pending", "enabled");
    const before = Date.now();

    const response = await login(username, PASSWORD);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, role: "administrador", pending: "verify" });
    const token = response.cookies.get(SESSION_COOKIE)!.value;
    const row = await sessionRow(token);
    expect(row.pending).toBe("verify");
    expect(row.expiresAt.getTime()).toBeGreaterThan(before);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + TEN_MINUTES);
    expect(await outcomesFor(username)).toEqual(["password_ok"]);
  });

  it("gates that session in the proxy: pages to /two-factor, APIs 403, logout through", async () => {
    const username = await createLogin("gate", "enabled");
    const token = (await login(username, PASSWORD)).cookies.get(SESSION_COOKIE)!.value;

    const page = await handleProxy(withCookie("/inventory", token));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/two-factor");
    expect(page.headers.get("x-middleware-request-x-user-id")).toBeNull();

    const api = await handleProxy(withCookie("/api/customers", token));
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "second_factor_required" });

    const logout = await handleProxy(withCookie("/api/logout", token));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("location")).toBeNull();
  });

  it.each(["none", "enrolling"] as const)("gives a user with 2FA %s a full session and a success", async (twoFactor) => {
    const username = await createLogin(`full-${twoFactor}`, twoFactor);

    const response = await login(username, PASSWORD);

    expect(await response.json()).toEqual({ ok: true, role: "administrador" });
    const token = response.cookies.get(SESSION_COOKIE)!.value;
    expect((await sessionRow(token)).pending).toBeNull();
    expect(await outcomesFor(username)).toEqual(["success"]);
    const page = await handleProxy(withCookie("/inventory", token));
    expect(page.headers.get("location")).toBeNull();
  });

  // A password_ok is not a success: it must not clear the failures before it (L28).
  it("locks after four failures, a right password and one more failure", async () => {
    const username = await createLogin("count", "enabled");
    const ip = freshIp();

    for (let i = 0; i < 4; i += 1) expect((await login(username, "incorrecta", ip)).status).toBe(401);
    expect((await login(username, PASSWORD, ip)).status).toBe(200);
    expect((await login(username, "incorrecta", ip)).status).toBe(401);

    expect((await userLocks([username])).get(username)).toBeInstanceOf(Date);
    expect((await login(username, PASSWORD, ip)).status).toBe(429);
  });
});
