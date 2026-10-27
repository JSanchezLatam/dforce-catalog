/**
 * Real-SQL proof for workshop-status-board WU1: the `pantalla` enum value (0035),
 * its session lifetime, its revocation and the admin floor. Unit tests inject the
 * session and user queries, so none of that is proven there. Run against the
 * THROWAWAY `dforce_e2e` database only.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const forged = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(forged.headers) }));
const redirected = vi.hoisted(() => ({ to: "" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to = to;
  },
}));

import { NextRequest } from "next/server";
import { authenticateUser } from "@/modules/auth/authenticate";
import { validateSession } from "@/modules/auth/session";
import { db } from "@/shared/db/client";
import { sessions, tecnico, users } from "@/shared/db/schema";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";
import { GET as usersGET } from "../app/api/users/route";
import AccountPage from "../app/(app)/account/page";
import InventoryPage from "../app/(app)/inventory/page";
import ServiceOrdersPage from "../app/(app)/service-orders/page";
import UsersPage from "../app/(app)/users/page";
import Home from "../app/page";
import { AdminSafetyError, changePassword, createUser, deactivateUser, updateUser } from "../modules/account/service";

const MIGRATIONS = path.resolve(import.meta.dirname, "../shared/db/migrations");
const PRE_DB = "dforce_e2e_pantalla_0034";
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "temporal-123";

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${database}`;
  return url.toString();
}

/** A copy of the real migrations folder holding only the files up to and including `lastIdx`. */
function foldedUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

describe("migration 0035 on a database at 0034 (E2E)", () => {
  it("pantalla is a valid role value and a user row with it inserts", async () => {
    const admin = new Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${PRE_DB}`);
    await admin.query(`CREATE DATABASE ${PRE_DB}`);
    const client = new Client({ connectionString: urlFor(PRE_DB) });
    await client.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: foldedUpTo(34) });
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
      await client.query(`INSERT INTO users (id, username, password_hash, role) VALUES ('u-tv', 'tv', 'x', 'pantalla')`);
      const { rows } = await client.query(`SELECT role::text AS role FROM users WHERE id = 'u-tv'`);
      expect(rows[0].role).toBe("pantalla");
    } finally {
      await client.end();
      await admin.query(`DROP DATABASE IF EXISTS ${PRE_DB}`);
      await admin.end();
    }
  }, 120_000);
});

describe("pantalla role (E2E)", () => {
  const stamp = Date.now();
  const made: string[] = [];
  let actorId: string;

  const mk = async (suffix: string, role: "administrador" | "tecnico" | "pantalla") => {
    const { id } = await createUser({ username: `e2e-pan-${suffix}-${stamp}`, password: PASSWORD, role });
    made.push(id);
    return { id, username: `e2e-pan-${suffix}-${stamp}`, role };
  };
  const rosterOf = (userId: string) => db.select().from(tecnico).where(eq(tecnico.userId, userId));
  const login = async (u: { username: string }) => {
    const r = await authenticateUser(u.username, PASSWORD);
    if (!r.ok) throw new Error("login refused");
    return r;
  };
  const sessionRows = (userId: string) => db.select().from(sessions).where(eq(sessions.userId, userId));
  const as = (user: { id: string; role: string }) => {
    forged.headers = { "x-user-id": user.id, "x-user-role": user.role };
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    actorId = (await mk("actor", "administrador")).id;
  }, 60_000);

  afterAll(async () => {
    await db.delete(sessions).where(inArray(sessions.userId, made));
    await db.delete(tecnico).where(inArray(tecnico.userId, made));
    await db.delete(users).where(inArray(users.id, made));
    await db.$client.end();
  });

  it("creating a pantalla user forces a password change and creates no roster row", async () => {
    const tv = await mk("create", "pantalla");
    const [row] = await db.select().from(users).where(eq(users.id, tv.id));
    expect(row.role).toBe("pantalla");
    expect(row.mustChangePassword).toBe(true);
    expect(await rosterOf(tv.id)).toHaveLength(0);
  });

  it("switching a non-tecnico to pantalla creates no roster row", async () => {
    const boss = await mk("switch", "administrador");
    await updateUser(actorId, boss.id, { role: "pantalla" });
    const [row] = await db.select().from(users).where(eq(users.id, boss.id));
    expect(row.role).toBe("pantalla");
    expect(await rosterOf(boss.id)).toHaveLength(0);
  });

  it("session lifetime follows the role: pantalla 180 days, administrador 7", async () => {
    const tv = await mk("ttl-tv", "pantalla");
    const boss = await mk("ttl-admin", "administrador");
    const [tvLogin, bossLogin] = [await login(tv), await login(boss)];
    const [tvRow] = await db.select().from(sessions).where(eq(sessions.id, tvLogin.token));
    const [bossRow] = await db.select().from(sessions).where(eq(sessions.id, bossLogin.token));
    expect(Math.abs(tvRow.expiresAt.getTime() - Date.now() - 180 * DAY_MS)).toBeLessThan(60_000);
    expect(Math.abs(bossRow.expiresAt.getTime() - Date.now() - 7 * DAY_MS)).toBeLessThan(60_000);
  });

  it("a second login on screen B leaves screen A's session valid", async () => {
    const tv = await mk("two-screens", "pantalla");
    const a = await login(tv);
    await login(tv);
    expect(await validateSession(a.token)).toMatchObject({ id: tv.id, role: "pantalla" });
  });

  it("after the forced password change, / resolves to /tablero/clientes", async () => {
    const tv = await mk("landing", "pantalla");
    const s = await login(tv);
    await changePassword(tv.id, PASSWORD, "otra-clave-456", s.token);
    const session = await validateSession(s.token);
    expect(session?.mustChangePassword).toBe(false);

    as({ id: tv.id, role: "pantalla" });
    await Home();
    expect(redirected.to).toBe("/tablero/clientes");
  });

  it("a forged pantalla is denied every application page and GET /api/users", async () => {
    const tv = await mk("denied", "pantalla");
    as(tv);
    for (const Page of [InventoryPage, ServiceOrdersPage, UsersPage, AccountPage]) {
      // Pages return their refusal before touching any query: the props are irrelevant here.
      const element = await (Page as unknown as (p: unknown) => Promise<{ type: unknown }>)({
        searchParams: Promise.resolve({}),
      });
      expect(element.type).toBe(PermissionDenied);
    }
    const res = await usersGET(new NextRequest("http://localhost/api/users", { headers: forged.headers }));
    expect(res.status).toBe(403);
  });

  // Runs the guarded write after every OTHER active administrador is deactivated inside the same
  // transaction; the refusal rolls that back, so no other file's admins are touched.
  const aloneAsAdmin = (targetId: string) => ({
    transaction: <T,>(fn: (tx: never) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.update(users).set({ deactivatedAt: new Date() }).where(and(eq(users.role, "administrador"), ne(users.id, targetId)));
        return fn(tx as never);
      }),
  });

  it("with one active administrador and pantalla users, deactivating or demoting them is last_active_admin", async () => {
    const lone = await mk("lone", "administrador");
    await mk("screen-1", "pantalla");
    await mk("screen-2", "pantalla");
    const tv = await mk("floor-actor", "pantalla");

    const deactivate = deactivateUser(tv.id, lone.id, { database: aloneAsAdmin(lone.id) });
    await expect(deactivate).rejects.toBeInstanceOf(AdminSafetyError);
    await expect(deactivate).rejects.toMatchObject({ reason: "last_active_admin" });
    await expect(updateUser(tv.id, lone.id, { role: "pantalla" }, { database: aloneAsAdmin(lone.id) })).rejects.toMatchObject({
      reason: "last_active_admin",
    });
    const [row] = await db.select().from(users).where(eq(users.id, lone.id));
    expect(row.role).toBe("administrador");
    expect(row.deactivatedAt).toBeNull();
  });

  it("deactivation and password reset revoke every session of a pantalla account", async () => {
    const reset = await mk("reset", "pantalla");
    await login(reset);
    await login(reset);
    await updateUser(actorId, reset.id, { password: "reseteada-789" });
    const afterReset = await sessionRows(reset.id);
    expect(afterReset).toHaveLength(2);
    expect(afterReset.every((s) => s.revokedAt !== null)).toBe(true);

    const off = await mk("deact", "pantalla");
    await login(off);
    await login(off);
    await deactivateUser(actorId, off.id);
    const afterOff = await sessionRows(off.id);
    expect(afterOff).toHaveLength(2);
    expect(afterOff.every((s) => s.revokedAt !== null)).toBe(true);
    expect(await authenticateUser(off.username, PASSWORD)).toEqual({ ok: false });
  });
});
