/**
 * Real-Postgres coverage for the 2FA reset (T10, S5, S13, A5): the deletes and
 * the session revoke, all in one transaction and for the target only; the
 * login that follows; the emergency command's plain-SQL copy; and the batched
 * read Gestión de usuarios shows the 2FA column and "Último acceso" from.
 */
import { execSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `env` reads process.env when its module loads, and static imports hoist above any plain statement.
vi.hoisted(() => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString(
    "base64",
  );
});

import { POST as LOGIN } from "@/app/api/login/route";
import { userAccessFacts } from "@/modules/auth/access-facts";
import { hashPassword } from "@/modules/auth/password";
import type { Role } from "@/modules/auth/roles";
import { sealSecret, totpKey } from "@/modules/auth/secret-box";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { TRUSTED_DEVICE_COOKIE } from "@/modules/auth/trusted-device";
import { resetTwoFactor } from "@/modules/auth/two-factor-reset";
import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, trustedDevices, users, userTotp } from "@/shared/db/schema";

import { resetTwoFactorByUsername } from "../../scripts/emergency.mjs";

const PREFIX = `e2e-2fr-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const HOUR = 60 * 60 * 1000;
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.82.0.${++ipCounter}`;

/** A user with an enabled secret, two recovery codes, a trusted device and two open sessions (one pending). */
async function createEnrolled(name: string, role: Role = "jefe_taller") {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role });
  made.push(id);
  await db.insert(userTotp).values({ userId: id, secretSealed: sealSecret(SECRET, id, totpKey()), enabledAt: new Date() });
  await db.insert(recoveryCodes).values([
    { id: randomUUID(), userId: id, codeHash: `hash-a-${id}` },
    { id: randomUUID(), userId: id, codeHash: `hash-b-${id}` },
  ]);
  const device = randomBytes(32).toString("base64url");
  await db.insert(trustedDevices).values({
    id: randomUUID(),
    userId: id,
    tokenHash: createHash("sha256").update(device).digest("hex"),
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
  await db.insert(sessions).values([
    { id: randomUUID(), userId: id, expiresAt: new Date(Date.now() + HOUR) },
    { id: randomUUID(), userId: id, expiresAt: new Date(Date.now() + HOUR), pending: "verify" },
  ]);
  return { id, username, device };
}

async function stateOf(userId: string) {
  return {
    totp: await db.select().from(userTotp).where(eq(userTotp.userId, userId)),
    codes: await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, userId)),
    devices: await db.select().from(trustedDevices).where(eq(trustedDevices.userId, userId)),
    sessions: await db.select().from(sessions).where(eq(sessions.userId, userId)),
  };
}

function expectUntouched(state: Awaited<ReturnType<typeof stateOf>>) {
  expect(state.totp).toHaveLength(1);
  expect(state.codes).toHaveLength(2);
  expect(state.devices).toHaveLength(1);
  expect(state.sessions).toHaveLength(2);
  expect(state.sessions.every((session) => session.revokedAt === null)).toBe(true);
}

function expectReset(state: Awaited<ReturnType<typeof stateOf>>) {
  expect(state.totp).toHaveLength(0);
  expect(state.codes).toHaveLength(0);
  expect(state.devices).toHaveLength(0);
  expect(state.sessions).toHaveLength(2);
  expect(state.sessions.every((session) => session.revokedAt !== null)).toBe(true);
}

async function login(username: string, device?: string) {
  const response = await LOGIN(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": freshIp(), ...(device ? { cookie: `${TRUSTED_DEVICE_COOKIE}=${device}` } : {}) },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  return { status: response.status, body: await response.json(), token: response.cookies.get(SESSION_COOKIE)?.value };
}

// One checked-out connection, as the command's own `pg.Client` is.
async function emergencyReset(username: string) {
  const client = await db.$client.connect();
  try {
    return await resetTwoFactorByUsername(client, username);
  } finally {
    client.release();
  }
}

describe("2FA reset against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("an administrator's reset of a jefe empties the three tables and revokes every session, for that user only", async () => {
    const admin = await createEnrolled("admin", "administrador");
    const jefe = await createEnrolled("jefe");
    const bystander = await createEnrolled("bystander");

    expect(await resetTwoFactor(admin.id, jefe.id)).toEqual({ ok: true });

    expectReset(await stateOf(jefe.id));
    expectUntouched(await stateOf(admin.id));
    expectUntouched(await stateOf(bystander.id));

    // The old device cookie no longer skips anything: a mandatory role enrols again (T8b).
    const next = await login(jefe.username, jefe.device);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ pending: "enroll" });
  });

  it("a tecnico's reset leads to a full login next time", async () => {
    const admin = await createEnrolled("admin-t", "administrador");
    const tecnico = await createEnrolled("tecnico", "tecnico");

    expect(await resetTwoFactor(admin.id, tecnico.id)).toEqual({ ok: true });

    expectReset(await stateOf(tecnico.id));
    const next = await login(tecnico.username);
    expect(next.status).toBe(200);
    expect(next.body).toEqual({ ok: true, role: "tecnico" });
  });

  it("refuses the administrator's own id and writes nothing", async () => {
    const admin = await createEnrolled("self", "administrador");

    expect(await resetTwoFactor(admin.id, admin.id)).toEqual({ ok: false, reason: "self_reset" });

    expectUntouched(await stateOf(admin.id));
  });

  it("answers not_found for an unknown user", async () => {
    const admin = await createEnrolled("admin-nf", "administrador");

    expect(await resetTwoFactor(admin.id, randomUUID())).toEqual({ ok: false, reason: "not_found" });
  });

  it("writes everything in one transaction: a failure after the writes leaves the user untouched", async () => {
    const admin = await createEnrolled("admin-tx", "administrador");
    const jefe = await createEnrolled("jefe-tx");
    const failing = ((fn: Parameters<typeof db.transaction>[0]) =>
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Error("fail after the writes");
      })) as typeof db.transaction;

    await expect(resetTwoFactor(admin.id, jefe.id, { transaction: failing })).rejects.toThrow("fail after the writes");

    expectUntouched(await stateOf(jefe.id));
  });

  describe("emergency command (S13: reset-2fa on the workshop PC)", () => {
    it("does the same reset by username and returns the role", async () => {
      const jefe = await createEnrolled("emergency");
      const bystander = await createEnrolled("emergency-bystander");

      expect(await emergencyReset(jefe.username)).toBe("jefe_taller");

      expectReset(await stateOf(jefe.id));
      expectUntouched(await stateOf(bystander.id));
      expect((await login(jefe.username, jefe.device)).body).toMatchObject({ pending: "enroll" });
    });

    it("refuses a username that does not exist and writes nothing", async () => {
      const bystander = await createEnrolled("emergency-ghost-bystander");

      expect(await emergencyReset(`${PREFIX}-ghost`)).toBeNull();

      expectUntouched(await stateOf(bystander.id));
    });
  });

  describe("userAccessFacts (Gestión de usuarios)", () => {
    it("reads each user's 2FA row and latest success, ignoring other outcomes and other users", async () => {
      const enrolled = await createEnrolled("facts-enrolled", "tecnico");
      const enrolling = `${PREFIX}-facts-enrolling`;
      const enrollingId = randomUUID();
      await db.insert(users).values({ id: enrollingId, username: enrolling, passwordHash: "x", role: "tecnico" });
      made.push(enrollingId);
      await db.insert(userTotp).values({ userId: enrollingId, secretSealed: "v1:x", enabledAt: null });
      const bare = `${PREFIX}-facts-bare`;
      const bareId = randomUUID();
      await db.insert(users).values({ id: bareId, username: bare, passwordHash: "x", role: "tecnico" });
      made.push(bareId);

      const latest = new Date(Date.now() - HOUR);
      const row = (userId: string, username: string, outcome: "success" | "password_ok" | "bad_password", at: Date) => ({
        id: randomUUID(),
        at,
        username,
        userId,
        ip: "10.82.1.1",
        outcome,
      });
      await db.insert(loginAttempts).values([
        row(enrolled.id, enrolled.username, "success", new Date(Date.now() - 5 * HOUR)),
        row(enrolled.id, enrolled.username, "success", latest),
        row(enrolled.id, enrolled.username, "password_ok", new Date(Date.now() - 10_000)),
        row(enrolled.id, enrolled.username, "bad_password", new Date(Date.now() - 5_000)),
        row(enrollingId, enrolling, "bad_password", new Date(Date.now() - 5_000)),
      ]);

      const facts = await userAccessFacts([enrolled.id, enrollingId, bareId]);

      expect(facts.get(enrolled.id)).toEqual({ twoFactor: "enabled", lastAccessAt: latest });
      expect(facts.get(enrollingId)).toEqual({ twoFactor: "enrolling", lastAccessAt: null });
      expect(facts.get(bareId)).toEqual({ twoFactor: null, lastAccessAt: null });
    });
  });
});
