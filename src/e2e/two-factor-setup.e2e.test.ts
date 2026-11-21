/**
 * Real-Postgres coverage for the mandatory 2FA setup (T8b, L41): the `enroll`
 * session the password step issues, the proxy confining it, the order with a
 * forced password change, and the setup routes swapping it for a full session.
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
import { POST as CONFIRM } from "@/app/api/two-factor/setup/confirm/route";
import { POST as START } from "@/app/api/two-factor/setup/start/route";
import { changePassword } from "@/modules/account/service";
import { hashPassword } from "@/modules/auth/password";
import type { Role } from "@/modules/auth/roles";
import { issueSession, replaceEnrollSession, SESSION_COOKIE } from "@/modules/auth/session";
import { totpAt } from "@/modules/auth/totp";
import { CHANGE_PASSWORD_PATH } from "@/modules/auth/forced-change";
import { TWO_FACTOR_SETUP_PATH } from "@/modules/auth/two-factor-gate";
import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";
import { handleProxy } from "@/proxy";

const PREFIX = `e2e-2fs-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.81.0.${++ipCounter}`;

async function createUser(name: string, role: Role, mustChangePassword = false): Promise<{ id: string; username: string }> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role, mustChangePassword });
  made.push(id);
  return { id, username };
}

async function login(username: string): Promise<{ token: string; body: Record<string, unknown>; expires: number }> {
  const response = await LOGIN(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": freshIp() },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.cookies.get(SESSION_COOKIE)!;
  return { token: cookie.value, body: await response.json(), expires: new Date(cookie.expires!).getTime() };
}

const post = (route: typeof START, path: string, token: string, body?: unknown) =>
  route(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
const start = (token: string) => post(START, "/api/two-factor/setup/start", token);
const confirm = (token: string, code: string) => post(CONFIRM, "/api/two-factor/setup/confirm", token, { code });

const proxyAt = (path: string, token: string) =>
  handleProxy(new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));

const sessionRow = async (token: string) => (await db.select().from(sessions).where(eq(sessions.id, token)))[0];
const totpRow = async (id: string) => (await db.select().from(userTotp).where(eq(userTotp.userId, id)))[0];
const outcomesFor = async (username: string) =>
  (await db.select().from(loginAttempts).where(eq(loginAttempts.username, username))).map((row) => row.outcome);

describe("mandatory 2FA setup against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it.each(["administrador", "jefe_taller"] as const)(
    "gives %s without 2FA an enroll session of thirty minutes and a success",
    async (role) => {
      const { username } = await createUser(`enroll-${role}`, role);
      const before = Date.now();

      const { token, body, expires } = await login(username);
      const after = Date.now();

      expect(body).toEqual({ ok: true, role, pending: "enroll" });
      const row = await sessionRow(token);
      expect(row.pending).toBe("enroll");
      expect(row.revokedAt).toBeNull();
      // Bounded from both sides: neither the 10-minute verify TTL nor the 7-day full one.
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * MINUTE - 1000);
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(after + 30 * MINUTE + 1000);
      expect(expires).toBe(row.expiresAt.getTime());
      expect(await outcomesFor(username)).toEqual(["success"]);
    },
  );

  // An unfinished secret from Mi cuenta is not 2FA: the setup's start replaces it.
  it("gives an administrador mid-enrolment an enroll session too", async () => {
    const { id, username } = await createUser("mid-enrolment", "administrador");
    await db.insert(userTotp).values({ userId: id, secretSealed: "v1:unfinished", enabledAt: null });

    expect((await login(username)).body).toEqual({ ok: true, role: "administrador", pending: "enroll" });
  });

  it("gives a tecnico without 2FA a full session", async () => {
    const { username } = await createUser("tecnico", "tecnico");

    const { token, body } = await login(username);

    expect(body).toEqual({ ok: true, role: "tecnico" });
    const row = await sessionRow(token);
    expect(row.pending).toBeNull();
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * DAY - MINUTE);
  });

  it("confines an enroll session to the setup paths and logout", async () => {
    const { id, username } = await createUser("confined", "administrador");
    const { token } = await login(username);

    const page = await proxyAt("/inventory", token);
    expect(page.headers.get("location")).toBe(`http://localhost${TWO_FACTOR_SETUP_PATH}`);
    const api = await proxyAt("/api/customers", token);
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "second_factor_required" });
    expect(api.headers.get("x-middleware-request-x-user-id")).toBeNull();

    for (const path of [TWO_FACTOR_SETUP_PATH, "/api/two-factor/setup/start", "/api/two-factor/setup/confirm", "/api/logout"]) {
      const through = await proxyAt(path, token);
      expect(through.headers.get("location")).toBeNull();
      expect(through.headers.get("x-middleware-request-x-user-id")).toBe(id);
    }
  });

  it("sends a forced password change first, then the setup", async () => {
    const { id, username } = await createUser("forced", "jefe_taller", true);
    const { token, body } = await login(username);
    expect(body).toMatchObject({ pending: "enroll" });

    for (const path of ["/inventory", TWO_FACTOR_SETUP_PATH]) {
      expect((await proxyAt(path, token)).headers.get("location")).toBe(`http://localhost${CHANGE_PASSWORD_PATH}`);
    }
    expect((await proxyAt(CHANGE_PASSWORD_PATH, token)).headers.get("location")).toBeNull();
    expect((await proxyAt("/api/two-factor/setup/start", token)).status).toBe(403);

    await changePassword(id, PASSWORD, "otra-clave-segura-456", token);

    expect((await sessionRow(token)).revokedAt).toBeNull();
    expect((await proxyAt("/inventory", token)).headers.get("location")).toBe(`http://localhost${TWO_FACTOR_SETUP_PATH}`);
    expect((await proxyAt(CHANGE_PASSWORD_PATH, token)).headers.get("location")).toBe(
      `http://localhost${TWO_FACTOR_SETUP_PATH}`,
    );
    expect((await proxyAt(TWO_FACTOR_SETUP_PATH, token)).headers.get("location")).toBeNull();
  });

  it("start then confirm enables 2FA, swaps the enroll session for a full one and answers 10 codes; the next login asks for the code", async () => {
    const { id, username } = await createUser("finish", "jefe_taller");
    const { token } = await login(username);

    const started = await start(token);
    expect(started.status).toBe(200);
    const { secret, qrDataUrl } = await started.json();
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(await totpRow(id)).toMatchObject({ enabledAt: null });

    const confirmed = await confirm(token, totpAt(secret.replace(/ /g, ""), new Date()));
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json();
    expect(body.redirect).toBe("/inventory");
    expect(body.codes).toHaveLength(10);
    expect(new Set(body.codes).size).toBe(10);

    expect((await totpRow(id)).enabledAt).not.toBeNull();
    expect(await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id))).toHaveLength(10);
    expect((await sessionRow(token)).revokedAt).not.toBeNull();

    const full = confirmed.cookies.get(SESSION_COOKIE)!;
    expect(full.value).not.toBe(token);
    const fullRow = await sessionRow(full.value);
    expect(fullRow).toMatchObject({ userId: id, pending: null, revokedAt: null });
    expect(fullRow.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * DAY - MINUTE);
    expect(new Date(full.expires!).getTime()).toBe(fullRow.expiresAt.getTime());
    expect((await proxyAt("/inventory", full.value)).headers.get("location")).toBeNull();

    // The spent enroll token cannot be swapped again.
    expect((await confirm(token, "123456")).status).toBe(401);

    const next = await login(username);
    expect(next.body).toEqual({ ok: true, role: "jefe_taller", pending: "verify" });
    expect((await sessionRow(next.token)).pending).toBe("verify");
  });

  // The guard behind the route: one enroll session becomes at most one full session, and nothing else swaps.
  it("swaps an enroll session once, and never a full, verify or revoked one", async () => {
    const { id } = await createUser("swap-once", "administrador");
    const enroll = await issueSession(id, "administrador", { pending: "enroll" });
    const full = await issueSession(id, "administrador");
    const verify = await issueSession(id, "administrador", { pending: "verify" });

    const [first, second] = await Promise.all([
      replaceEnrollSession(enroll.token, id, "administrador"),
      replaceEnrollSession(enroll.token, id, "administrador"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await replaceEnrollSession(full.token, id, "administrador")).toBeNull();
    expect(await replaceEnrollSession(verify.token, id, "administrador")).toBeNull();
    expect((await sessionRow(full.token)).revokedAt).toBeNull();
    expect((await sessionRow(verify.token)).revokedAt).toBeNull();
    // Issued sessions: the three above plus exactly one full one from the swap.
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(4);
  });

  it("refuses a session that is not enroll with no_pending_session, and writes nothing", async () => {
    const { id } = await createUser("not-enroll", "administrador");
    const full = await issueSession(id, "administrador");
    const verify = await issueSession(id, "administrador", { pending: "verify" });

    for (const token of [full.token, verify.token, "not-a-token"]) {
      const started = await start(token);
      expect(started.status).toBe(401);
      expect(await started.json()).toEqual({ error: "no_pending_session" });
      const confirmed = await confirm(token, "123456");
      expect(confirmed.status).toBe(401);
      expect(await confirmed.json()).toEqual({ error: "no_pending_session" });
    }
    expect(await totpRow(id)).toBeUndefined();
    expect((await sessionRow(full.token)).revokedAt).toBeNull();
  });

  it("answers a wrong code with invalid_code, leaves 2FA off and the enroll session open, and counts nothing", async () => {
    const { id, username } = await createUser("wrong", "administrador");
    const { token } = await login(username);
    const { secret } = await (await start(token)).json();
    const right = totpAt(secret.replace(/ /g, ""), new Date());
    const wrong = `${(Number(right[0]) + 1) % 10}${right.slice(1)}`;

    const response = await confirm(token, wrong);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_code" });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect((await totpRow(id)).enabledAt).toBeNull();
    expect(await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id))).toHaveLength(0);
    expect((await sessionRow(token)).revokedAt).toBeNull();
    expect(await outcomesFor(username)).toEqual(["success"]);
    expect(
      await db.select().from(sessions).where(and(eq(sessions.userId, id), eq(sessions.pending, "enroll"))),
    ).toHaveLength(1);
  });
});
