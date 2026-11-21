/**
 * Process-level coverage for the emergency command (S13, L52): what the
 * operator at the workshop PC reads and the exit code, from a real
 * `node scripts/emergency.mjs` against the e2e database. The functions it
 * calls are covered in `login-lockout` and `two-factor-reset`.
 */
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { eq, ilike, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { loginAttempts, recoveryCodes, sessions, users, userTotp } from "@/shared/db/schema";

const PREFIX = `e2e-cli-${Date.now()}`;
const made: string[] = [];
const USAGE = "Uso:\n  node scripts/emergency.mjs unlock <usuario>\n  node scripts/emergency.mjs reset-2fa <usuario>\n";

function emergency(...args: string[]) {
  // The e2e URL explicitly: without it the command would read the checkout's `.env`.
  const result = spawnSync("node", ["scripts/emergency.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A user with an enabled secret, a recovery code and an open session. */
async function createEnrolled(name: string, role: Role) {
  const username = `${PREFIX}-${name}`;
  const id = randomUUID();
  await db.insert(users).values({ id, username, passwordHash: "x", role });
  made.push(id);
  await db.insert(userTotp).values({ userId: id, secretSealed: "v1:x", enabledAt: new Date() });
  await db.insert(recoveryCodes).values({ id: randomUUID(), userId: id, codeHash: `hash-${id}` });
  await db.insert(sessions).values({ id: randomUUID(), userId: id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  return { id, username };
}

describe("node scripts/emergency.mjs", () => {
  beforeAll(() => {
    // Never the dev database: these tests write and delete users.
    expect(process.env.DATABASE_URL).toMatch(/\/dforce_e2e$/);
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
  }, 60_000);

  afterAll(async () => {
    await db.delete(loginAttempts).where(ilike(loginAttempts.username, `${PREFIX}%`));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("with no arguments prints the usage and exits 1", () => {
    expect(emergency()).toEqual({ status: 1, stdout: "", stderr: USAGE });
  });

  it("unlock <usuario> unlocks a real user and exits 0", async () => {
    const { id, username } = await createEnrolled("unlock", "tecnico");

    expect(emergency("unlock", username)).toEqual({
      status: 0,
      stdout: `Usuario "${username}" desbloqueado. Ya puede volver a entrar.\n`,
      stderr: "",
    });
    const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.userId, id));
    expect(rows.map((row) => row.outcome)).toEqual(["unlocked"]);
  });

  it("unlock of an unknown user says so and exits 1", () => {
    const username = `${PREFIX}-ghost`;

    expect(emergency("unlock", username)).toEqual({
      status: 1,
      stdout: "",
      stderr: `No existe el usuario "${username}". Revisá mayúsculas y minúsculas.\n`,
    });
  });

  it("reset-2fa of a jefe_taller gives the mandatory-role message, exits 0 and removes the 2FA rows", async () => {
    const { id, username } = await createEnrolled("jefe", "jefe_taller");

    expect(emergency("reset-2fa", username)).toEqual({
      status: 0,
      stdout: `2FA de "${username}" reseteada. La próxima vez que entre la va a tener que configurar de nuevo.\n`,
      stderr: "",
    });
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, id))).toEqual([]);
    expect(await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, id))).toEqual([]);
    const open = await db.select().from(sessions).where(eq(sessions.userId, id));
    expect(open).toHaveLength(1);
    expect(open[0].revokedAt).not.toBeNull();
  });

  it("reset-2fa of a tecnico gives the optional-role message and exits 0", async () => {
    const { username } = await createEnrolled("tecnico", "tecnico");

    expect(emergency("reset-2fa", username)).toEqual({
      status: 0,
      stdout: `2FA de "${username}" reseteada. Va a poder activarla de nuevo desde Mi cuenta.\n`,
      stderr: "",
    });
  });

  it("reset-2fa of an unknown user says so and exits 1", () => {
    const username = `${PREFIX}-ghost-2fa`;

    expect(emergency("reset-2fa", username)).toEqual({
      status: 1,
      stdout: "",
      stderr: `No existe el usuario "${username}". Revisá mayúsculas y minúsculas.\n`,
    });
  });
});
