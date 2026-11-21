/**
 * Real-Postgres coverage for 2FA enrolment from Mi cuenta (T8a): the guarded
 * upsert and UPDATEs, the recovery codes being replaced rather than added, and
 * the hand-off to the login steps of T6 and T7.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
import {
  confirmEnrolment,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startEnrolment,
  twoFactorStatus,
} from "@/modules/auth/enrolment";
import { hashPassword } from "@/modules/auth/password";
import { hashRecoveryCode, matchRecoveryCode } from "@/modules/auth/recovery-codes";
import { openSecret, totpKey } from "@/modules/auth/secret-box";
import { verifySecondFactor } from "@/modules/auth/second-factor";
import { issueSession, SESSION_COOKIE } from "@/modules/auth/session";
import { totpAt } from "@/modules/auth/totp";
import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";
import type { Role } from "@/modules/auth/roles";

const PREFIX = `e2e-2fe-${Date.now()}`;
const PASSWORD = "clave-correcta-k7";
const made: string[] = [];

let ipCounter = 0;
const freshIp = () => `10.80.0.${++ipCounter}`;

/** Each step its own 30-second window, so a code confirm stored is never replayed by the next call. */
const T0 = new Date();
const at = (steps: number) => new Date(T0.getTime() + steps * 30_000);
const nowAt = (steps: number) => ({ now: () => at(steps) });
const wrongOf = (code: string) => `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;

async function createUser(name: string, role: Role): Promise<{ id: string; username: string }> {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: await hashPassword(PASSWORD), role });
  made.push(id);
  return { id, username };
}

/** Start and confirm at step 0; returns the plain secret and the codes shown once. */
async function enrol(id: string): Promise<{ secret: string; codes: string[] }> {
  const started = await startEnrolment(id, "Taller E2E", nowAt(0));
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);
  const secret = started.secret.replace(/ /g, "");
  const confirmed = await confirmEnrolment(id, totpAt(secret, at(0)), nowAt(0));
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.reason}`);
  return { secret, codes: confirmed.codes };
}

const totpRow = async (id: string) => (await db.select().from(userTotp).where(eq(userTotp.userId, id)))[0];
const codeRows = (id: string) => db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id));
const sessionRow = async (token: string) => (await db.select().from(sessions).where(eq(sessions.id, token)))[0];

async function login(username: string): Promise<{ token: string; body: { pending?: string } }> {
  const response = await LOGIN(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": freshIp() },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  return { token: response.cookies.get(SESSION_COOKIE)!.value, body: await response.json() };
}

describe("2FA enrolment against a real database", () => {
  beforeAll(() => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("start then confirm enables 2FA with the step stored and 10 hashed codes, returned once in plain text", async () => {
    const { id, username } = await createUser("enrol", "tecnico");

    const started = await startEnrolment(id, "Taller E2E", nowAt(0));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.secret).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4})+$/);
    expect(started.otpauthUri).toContain(`otpauth://totp/Taller%20E2E:${encodeURIComponent(username)}?`);
    expect(started.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(await totpRow(id)).toMatchObject({ enabledAt: null, lastStep: null });
    expect(await twoFactorStatus(id)).toEqual({ enabled: false, enabledAt: null, codesLeft: 0 });

    const secret = started.secret.replace(/ /g, "");
    const confirmed = await confirmEnrolment(id, totpAt(secret, at(0)), nowAt(0));

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.codes).toHaveLength(10);
    const row = await totpRow(id);
    expect(row.enabledAt).toEqual(at(0));
    expect(row.lastStep).toBe(Math.floor(at(0).getTime() / 30_000));
    const stored = await codeRows(id);
    expect(stored).toHaveLength(10);
    // Hashed, never the plain code.
    expect(stored.map((r) => r.codeHash).sort()).toEqual(confirmed.codes.map((c) => hashRecoveryCode(c, totpKey())).sort());
    expect(stored.some((r) => confirmed.codes.includes(r.codeHash))).toBe(false);
    expect(await twoFactorStatus(id)).toEqual({ enabled: true, enabledAt: at(0), codesLeft: 10 });
  });

  it("a restart replaces an unfinished secret, so the first one no longer confirms", async () => {
    const { id } = await createUser("restart-unfinished", "tecnico");
    const first = await startEnrolment(id, "Taller E2E", nowAt(0));
    const second = await startEnrolment(id, "Taller E2E", nowAt(0));
    if (!first.ok || !second.ok) throw new Error("start failed");

    expect(second.secret).not.toBe(first.secret);
    // The first secret no longer confirms.
    const stale = await confirmEnrolment(id, totpAt(first.secret.replace(/ /g, ""), at(0)), nowAt(0));
    expect(stale).toEqual({ ok: false, reason: "invalid_code" });
    expect((await totpRow(id)).enabledAt).toBeNull();
  });

  it("a wrong code at confirm leaves 2FA disabled and writes no codes", async () => {
    const { id } = await createUser("confirm-wrong", "tecnico");
    const started = await startEnrolment(id, "Taller E2E", nowAt(0));
    if (!started.ok) throw new Error("start failed");
    const right = totpAt(started.secret.replace(/ /g, ""), at(0));

    expect(await confirmEnrolment(id, wrongOf(right), nowAt(0))).toEqual({ ok: false, reason: "invalid_code" });

    expect(await totpRow(id)).toMatchObject({ enabledAt: null, lastStep: null });
    expect(await codeRows(id)).toHaveLength(0);
    expect((await twoFactorStatus(id)).enabled).toBe(false);
  });

  it("refuses a restart once enabled and keeps the enabled secret", async () => {
    const { id } = await createUser("restart-enabled", "tecnico");
    await enrol(id);
    const before = await totpRow(id);

    expect(await startEnrolment(id, "Taller E2E", nowAt(1))).toEqual({ ok: false, reason: "already_enabled" });

    expect(await totpRow(id)).toEqual(before);
    expect(await codeRows(id)).toHaveLength(10);
  });

  it("after enrolment the next login is a pending verify session, and a returned recovery code passes the second step", async () => {
    const { id, username } = await createUser("login", "tecnico");
    const { codes } = await enrol(id);

    const { token, body } = await login(username);
    expect(body.pending).toBe("verify");
    expect((await sessionRow(token)).pending).toBe("verify");

    const result = await verifySecondFactor({ token, recoveryCode: codes[3], ip: freshIp() });
    expect(result.ok).toBe(true);
    expect(await twoFactorStatus(id)).toMatchObject({ enabled: true, codesLeft: 9 });
  });

  it("regenerate needs a right app code, and replaces all 10 codes so the old ones fail", async () => {
    const { id } = await createUser("regenerate", "tecnico");
    const { secret, codes: old } = await enrol(id);

    expect(await regenerateRecoveryCodes(id, wrongOf(totpAt(secret, at(1))), nowAt(1))).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect((await codeRows(id)).map((r) => r.codeHash).sort()).toEqual(old.map((c) => hashRecoveryCode(c, totpKey())).sort());

    const fresh = await regenerateRecoveryCodes(id, totpAt(secret, at(1)), nowAt(1));
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.codes).toHaveLength(10);
    const hashes = (await codeRows(id)).map((r) => r.codeHash);
    expect(hashes).toHaveLength(10);
    for (const code of old) expect(matchRecoveryCode(code, hashes, totpKey())).toBeNull();
    for (const code of fresh.codes) expect(matchRecoveryCode(code, hashes, totpKey())).not.toBeNull();
    expect((await totpRow(id)).lastStep).toBe(Math.floor(at(1).getTime() / 30_000));

    // The same app code works once.
    expect(await regenerateRecoveryCodes(id, totpAt(secret, at(1)), nowAt(1))).toEqual({ ok: false, reason: "invalid_code" });
  });

  // A stolen session must not get unlimited guesses at the app code: wrong
  // re-authentication codes count toward the same user lock as the login (S6).
  it("counts wrong re-authentication codes toward the user lock, then refuses even the right code", async () => {
    const { id, username } = await createUser("reauth-lock", "tecnico");
    const { secret } = await enrol(id);

    for (let i = 0; i < 5; i += 1) {
      expect(await regenerateRecoveryCodes(id, wrongOf(totpAt(secret, at(1))), nowAt(1))).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    }
    const badCodes = (await db.select().from(loginAttempts).where(eq(loginAttempts.username, username))).filter(
      (row) => row.outcome === "bad_code",
    );
    expect(badCodes).toHaveLength(5);

    expect(await regenerateRecoveryCodes(id, totpAt(secret, at(1)), nowAt(1))).toEqual({ ok: false, reason: "locked" });
    expect(await disableTwoFactor(id, "tecnico", totpAt(secret, at(1)), "any-token", nowAt(1))).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(await twoFactorStatus(id)).toMatchObject({ enabled: true });
  });

  // Pins the advisory locks in re-authentication: without them parallel guesses each pass the lock check.
  it("counts at most five of fifteen parallel wrong re-authentication codes", async () => {
    const { id, username } = await createUser("reauth-parallel", "tecnico");
    const { secret } = await enrol(id);
    const wrong = wrongOf(totpAt(secret, at(1)));

    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        i % 2 ? regenerateRecoveryCodes(id, wrong, nowAt(1)) : disableTwoFactor(id, "tecnico", wrong, "k", nowAt(1)),
      ),
    );

    const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.username, username));
    expect(rows.filter((row) => row.outcome === "bad_code")).toHaveLength(5);
  });

  // Pins confirm's guard on the exact secret it checked: a restart racing it must never get enabled.
  it("never enables a secret other than the one confirm checked, when a restart races it", async () => {
    for (let i = 0; i < 20; i += 1) {
      const { id } = await createUser(`confirm-race-${i}`, "tecnico");
      const started = await startEnrolment(id, "Taller E2E", nowAt(0));
      if (!started.ok) throw new Error(started.reason);
      const secret = started.secret.replace(/ /g, "");

      const [confirmed, restarted] = await Promise.all([
        confirmEnrolment(id, totpAt(secret, at(0)), nowAt(0)),
        startEnrolment(id, "Taller E2E", nowAt(0)),
      ]);

      const row = await totpRow(id);
      const codes = await codeRows(id);
      if (row.enabledAt) {
        expect(openSecret(row.secretSealed, id, totpKey())).toBe(secret);
        expect(confirmed.ok).toBe(true);
        expect(restarted.ok).toBe(false);
        expect(codes).toHaveLength(10);
      } else {
        expect(confirmed.ok).toBe(false);
        expect(codes).toHaveLength(0);
      }
    }
  });

  it("refuses to disable an administrador even with a right code, and keeps everything", async () => {
    const { id } = await createUser("disable-admin", "administrador");
    const { secret } = await enrol(id);

    expect(await disableTwoFactor(id, "administrador", totpAt(secret, at(1)), "keep", nowAt(1))).toEqual({
      ok: false,
      reason: "required_for_role",
    });
    expect((await totpRow(id)).enabledAt).not.toBeNull();
    expect(await codeRows(id)).toHaveLength(10);
  });

  it("disable for a tecnico needs a right code, then removes 2FA, revokes the other sessions and the next login is full", async () => {
    const { id, username } = await createUser("disable-tec", "tecnico");
    const { secret } = await enrol(id);
    const current = await issueSession(id, "tecnico");
    const other = await issueSession(id, "tecnico");

    expect(await disableTwoFactor(id, "tecnico", wrongOf(totpAt(secret, at(1))), current.token, nowAt(1))).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect((await totpRow(id)).enabledAt).not.toBeNull();
    expect((await sessionRow(other.token)).revokedAt).toBeNull();

    expect(await disableTwoFactor(id, "tecnico", totpAt(secret, at(1)), current.token, nowAt(1))).toEqual({ ok: true });

    expect(await totpRow(id)).toBeUndefined();
    expect(await codeRows(id)).toHaveLength(0);
    expect((await sessionRow(current.token)).revokedAt).toBeNull();
    expect((await sessionRow(other.token)).revokedAt).toBeInstanceOf(Date);
    const { token, body } = await login(username);
    expect(body.pending).toBeUndefined();
    expect((await sessionRow(token)).pending).toBeNull();
  });

  // A restore without the original .env: an install problem, never a wrong code (T7's B1).
  it("with a key that no longer opens the secret, confirm, regenerate and disable answer unavailable and write nothing", async () => {
    const otherKey = () => Buffer.alloc(32, 7);
    const pendingUser = await createUser("wrong-key-pending", "tecnico");
    const started = await startEnrolment(pendingUser.id, "Taller E2E", nowAt(0));
    if (!started.ok) throw new Error("start failed");
    const pendingSecret = started.secret.replace(/ /g, "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await confirmEnrolment(pendingUser.id, totpAt(pendingSecret, at(0)), { ...nowAt(0), key: otherKey }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await totpRow(pendingUser.id)).toMatchObject({ enabledAt: null, lastStep: null });
    expect(await codeRows(pendingUser.id)).toHaveLength(0);

    const { id } = await createUser("wrong-key-enabled", "tecnico");
    const { secret } = await enrol(id);
    const current = await issueSession(id, "tecnico");
    const other = await issueSession(id, "tecnico");
    const before = { totp: await totpRow(id), codes: (await codeRows(id)).map((r) => r.codeHash).sort() };

    expect(await regenerateRecoveryCodes(id, totpAt(secret, at(1)), { ...nowAt(1), key: otherKey })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await disableTwoFactor(id, "tecnico", totpAt(secret, at(1)), current.token, { ...nowAt(1), key: otherKey })).toEqual({
      ok: false,
      reason: "unavailable",
    });

    expect(await totpRow(id)).toEqual(before.totp);
    expect((await codeRows(id)).map((r) => r.codeHash).sort()).toEqual(before.codes);
    expect((await sessionRow(other.token)).revokedAt).toBeNull();
    error.mockRestore();
  });
});
