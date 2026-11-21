/**
 * Real-Postgres coverage for trusted devices (T9, L45): the hash lookup with
 * its same-user and expiry predicates, the device stored with the second
 * step's success, and every revocation (password change, disable, "Olvidar").
 */
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `env` reads process.env when its module loads, and static imports hoist above any plain statement.
vi.hoisted(() => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
    "base64",
  );
});

import { POST as FORGET_DEVICES } from "@/app/api/account/two-factor/forget-devices/route";
import { POST as CHANGE_PASSWORD } from "@/app/api/account/password/route";
import { POST as LOGIN } from "@/app/api/login/route";
import { POST as VERIFY } from "@/app/api/two-factor/verify/route";
import { deactivateUser, updateUser } from "@/modules/account/service";
import { disableTwoFactor } from "@/modules/auth/enrolment";
import { hashPassword } from "@/modules/auth/password";
import { sealSecret, totpKey } from "@/modules/auth/secret-box";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { totpAt } from "@/modules/auth/totp";
import { purgeExpiredTrustedDevices, TRUSTED_DEVICE_COOKIE } from "@/modules/auth/trusted-device";
import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { loginAttempts, sessions, trustedDevices, users, userTotp } from "@/shared/db/schema";

const PREFIX = `e2e-2ft-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const NEW_PASSWORD = "clave-nueva-larga-k9";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DAY = 24 * 60 * 60 * 1000;
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.81.0.${++ipCounter}`;
const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

async function createLogin(
  name: string,
  { role = "tecnico", twoFactor = true, mustChangePassword = false }: { role?: Role; twoFactor?: boolean; mustChangePassword?: boolean } = {},
): Promise<{ id: string; username: string }> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role, mustChangePassword });
  made.push(id);
  if (twoFactor) {
    await db.insert(userTotp).values({ userId: id, secretSealed: sealSecret(SECRET, id, totpKey()), enabledAt: new Date() });
  }
  return { id, username };
}

async function login(username: string, device?: string, password = PASSWORD) {
  const response = await LOGIN(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": freshIp(), ...(device ? { cookie: `${TRUSTED_DEVICE_COOKIE}=${device}` } : {}) },
      body: JSON.stringify({ username, password }),
    }),
  );
  const body = await response.json();
  return { status: response.status, body, token: response.cookies.get(SESSION_COOKIE)?.value };
}

const verify = (token: string, body: object) =>
  VERIFY(
    new NextRequest("http://localhost/api/two-factor/verify", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "x-forwarded-for": freshIp() },
      body: JSON.stringify(body),
    }),
  );

/** The full second step with the box checked; returns the device cookie and the full session. */
async function trust(username: string): Promise<{ device: string; session: string }> {
  const pending = await login(username);
  expect(pending.body).toMatchObject({ pending: "verify" });
  const response = await verify(pending.token!, { code: totpAt(SECRET, new Date()), trustDevice: true });
  expect(response.status).toBe(200);
  return { device: response.cookies.get(TRUSTED_DEVICE_COOKIE)!.value, session: response.cookies.get(SESSION_COOKIE)!.value };
}

const devicesOf = (userId: string) => db.select().from(trustedDevices).where(eq(trustedDevices.userId, userId));
const attemptsFor = (username: string) => db.select().from(loginAttempts).where(eq(loginAttempts.username, username));
const sessionRow = async (token: string) => (await db.select().from(sessions).where(eq(sessions.id, token)))[0];
const sessionHeaders = (userId: string, session: string, role: Role = "tecnico") => ({
  "x-user-id": userId,
  "x-user-role": role,
  "Content-Type": "application/json",
  cookie: `${SESSION_COOKIE}=${session}`,
});

describe("trusted devices against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("a right code with the box checked sets a 30-day httpOnly cookie and stores only its hash", async () => {
    const { id, username } = await createLogin("trust");
    const pending = await login(username);
    const before = Date.now();

    const response = await verify(pending.token!, { code: totpAt(SECRET, new Date()), trustDevice: true });

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(TRUSTED_DEVICE_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie.secure).toBeFalsy();
    expect(Buffer.from(cookie.value, "base64url")).toHaveLength(32);
    const expires = new Date(cookie.expires!).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);

    const rows = await devicesOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(cookie.value));
    expect(JSON.stringify(rows)).not.toContain(cookie.value);
    // The cookie's expiry is serialized to the second.
    expect(Math.abs(rows[0].expiresAt.getTime() - expires)).toBeLessThan(1000);
  });

  it("the next login with the cookie skips the code with a full session, recorded as trusted_device", async () => {
    const { username } = await createLogin("skip");
    const { device } = await trust(username);

    const next = await login(username, device);

    expect(next.status).toBe(200);
    expect(next.body).toEqual({ ok: true, role: "tecnico" });
    expect(await sessionRow(next.token!)).toMatchObject({ pending: null, revokedAt: null });
    const rows = await attemptsFor(username);
    const latest = rows.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    expect(latest).toMatchObject({ outcome: "success", secondFactor: "trusted_device" });
  });

  it("a right code without the box sets no cookie and stores no device", async () => {
    const { id, username } = await createLogin("no-box");
    const pending = await login(username);

    const response = await verify(pending.token!, { code: totpAt(SECRET, new Date()) });

    expect(response.status).toBe(200);
    expect(response.cookies.get(TRUSTED_DEVICE_COOKIE)).toBeUndefined();
    expect(await devicesOf(id)).toHaveLength(0);
  });

  it("ignores another user's device cookie and asks for the code", async () => {
    const owner = await createLogin("owner");
    const other = await createLogin("other");
    const { device } = await trust(owner.username);

    const next = await login(other.username, device);

    expect(next.body).toMatchObject({ pending: "verify" });
    expect(await sessionRow(next.token!)).toMatchObject({ pending: "verify" });
  });

  it("ignores an expired device and asks for the code", async () => {
    const { id, username } = await createLogin("expired");
    const token = "expired-device-token";
    await db.insert(trustedDevices).values({
      id: randomUUID(),
      userId: id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 31 * DAY),
    });

    const next = await login(username, token);

    expect(next.body).toMatchObject({ pending: "verify" });
  });

  it("still refuses and counts a wrong password sent with a valid device cookie", async () => {
    const { username } = await createLogin("wrong-password");
    const { device } = await trust(username);

    const next = await login(username, device, "contraseña-equivocada");

    expect(next.status).toBe(401);
    expect(next.token).toBeUndefined();
    const latest = (await attemptsFor(username)).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    expect(latest).toMatchObject({ outcome: "bad_password", secondFactor: null });
  });

  it.each([
    ["a self-service password change", false],
    ["a forced password change", true],
  ])("%s forgets every device, so the next login asks for the code", async (_label, mustChangePassword) => {
    const { id, username } = await createLogin(`password-${mustChangePassword}`, { mustChangePassword });
    const { device, session } = await trust(username);

    const response = await CHANGE_PASSWORD(
      new NextRequest("http://localhost/api/account/password", {
        method: "POST",
        headers: sessionHeaders(id, session),
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await devicesOf(id)).toHaveLength(0);
    expect((await login(username, device, NEW_PASSWORD)).body).toMatchObject({ pending: "verify" });
  });

  // S9 covers an administrator's reset too: that password is now known to someone else.
  it("an administrator's password reset forgets every device of that user", async () => {
    const { id, username } = await createLogin("admin-reset");
    const { id: adminId } = await createLogin("admin-actor", { role: "administrador", twoFactor: false });
    const { device } = await trust(username);

    await updateUser(adminId, id, { password: NEW_PASSWORD });

    expect(await devicesOf(id)).toHaveLength(0);
    expect((await login(username, device, NEW_PASSWORD)).body).toMatchObject({ pending: "verify" });
  });

  // A5: a reactivated user must not skip the code with a cookie from before.
  it("deactivating a user forgets every device of that user", async () => {
    const { id, username } = await createLogin("deactivated");
    const { id: adminId } = await createLogin("deactivator", { role: "administrador", twoFactor: false });
    await trust(username);

    await deactivateUser(adminId, id);

    expect(await devicesOf(id)).toHaveLength(0);
  });

  it("disabling 2FA forgets every device", async () => {
    const { id, username } = await createLogin("disable");
    const { device, session } = await trust(username);
    // The login spent the current step; the next one re-authenticates.
    const later = new Date(Date.now() + 60_000);

    const result = await disableTwoFactor(id, "tecnico", totpAt(SECRET, later), session, { now: () => later });

    expect(result).toEqual({ ok: true });
    expect(await devicesOf(id)).toHaveLength(0);
    // Re-enabled, the old cookie still skips nothing.
    await db.insert(userTotp).values({ userId: id, secretSealed: sealSecret(SECRET, id, totpKey()), enabledAt: new Date() });
    expect((await login(username, device)).body).toMatchObject({ pending: "verify" });
  });

  it("Olvidar dispositivos de confianza forgets every device of the session user, and only theirs", async () => {
    const { id, username } = await createLogin("forget");
    const bystander = await createLogin("bystander");
    const { device, session } = await trust(username);
    // A second browser of the same user; a second login would replay the code's step.
    await db.insert(trustedDevices).values({
      id: randomUUID(),
      userId: id,
      tokenHash: sha256(`${PREFIX}-second-browser`),
      expiresAt: new Date(Date.now() + DAY),
    });
    await trust(bystander.username);

    const response = await FORGET_DEVICES(
      new NextRequest("http://localhost/api/account/two-factor/forget-devices", {
        method: "POST",
        headers: sessionHeaders(id, session),
      }),
    );

    expect(response.status).toBe(200);
    expect(await devicesOf(id)).toHaveLength(0);
    expect(await devicesOf(bystander.id)).toHaveLength(1);
    expect((await login(username, device)).body).toMatchObject({ pending: "verify" });
  });

  it("a mandatory role without 2FA still gets enroll, whatever device cookie it sends", async () => {
    const { id, username } = await createLogin("mandatory", { role: "administrador", twoFactor: false });
    const token = "admin-device-token";
    await db.insert(trustedDevices).values({
      id: randomUUID(),
      userId: id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + DAY),
    });

    const next = await login(username, token);

    expect(next.body).toEqual({ ok: true, role: "administrador", pending: "enroll" });
  });

  it("the retention deletes expired devices only", async () => {
    const { id } = await createLogin("retention");
    const now = new Date();
    const row = (name: string, expiresAt: Date) => ({ id: randomUUID(), userId: id, tokenHash: sha256(`${PREFIX}-${name}`), expiresAt });
    const expired = row("expired", new Date(now.getTime() - 1000));
    const live = row("live", new Date(now.getTime() + DAY));
    await db.insert(trustedDevices).values([expired, live]);

    const deleted = await purgeExpiredTrustedDevices(now);

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect((await devicesOf(id)).map((r) => r.id)).toEqual([live.id]);
  });
});
