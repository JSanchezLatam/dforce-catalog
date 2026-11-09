/**
 * Real SQL, throwaway database (`dforce_portal_test`, never `dforce_portal`):
 *   DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_portal_test npm run test:e2e
 * Goes through the real login route: throttle upsert, window reset, lock, success delete
 * and the lock being shared by a second server instance (its own module graph and pool).
 * The inbox list queries (filter WHERE, GROUP BY counts, ORDER BY) run against the real table too.
 */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../src/db/client";
import { supportFeedback, supportLoginThrottle } from "../src/db/schema";
import { listFeedback, statusCounts } from "../src/support/queries";

type Post = (request: Request) => Promise<Response>;
const PASSWORD = "e2e-password";
const LOCKED = "Demasiados intentos. Probá de nuevo en unos minutos.";

const attempt = (post: Post, password: string, ip = "203.0.113.7") =>
  post(
    new Request("http://portal.test/api/support/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ password }),
    }),
  );
const row = async (ip = "203.0.113.7") =>
  (await db.select().from(supportLoginThrottle).where(eq(supportLoginThrottle.ip, ip)))[0];
const fail = async (post: Post, times: number, ip?: string) => {
  for (let i = 0; i < times; i++) expect((await attempt(post, "nope", ip)).status).toBe(401);
};

let POST: Post;
beforeAll(async () => {
  process.env.SUPPORT_PASSWORD = PASSWORD;
  process.env.SUPPORT_SESSION_SECRET = "e2e-secret";
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../src/db/migrations") });
  POST = (await import("../app/api/support/login/route")).POST;
});
beforeEach(async () => {
  await db.delete(supportLoginThrottle);
  await db.delete(supportFeedback);
});
afterAll(async () => {
  await db.delete(supportLoginThrottle);
  await db.delete(supportFeedback);
  await db.$client.end(); // only this pool: the vi.resetModules() copies above own theirs
});

describe("support login throttle e2e", () => {
  it("the first failure inserts a row with failures=1 and no lock", async () => {
    await fail(POST, 1);
    const r = await row();
    expect(r.failures).toBe(1);
    expect(r.lockedUntil).toBeNull();
  });

  it("five failures lock; the sixth is refused even with the correct password, with no cookie", async () => {
    await fail(POST, 5);
    const r = await row();
    expect(r.failures).toBe(5);
    expect(r.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const res = await attempt(POST, PASSWORD);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: LOCKED });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("four failures do not lock: the correct password still gets in", async () => {
    await fail(POST, 4);
    expect((await attempt(POST, PASSWORD)).status).toBe(200);
  });

  it("a lock that has elapsed lets the correct password in, and the row is gone", async () => {
    await fail(POST, 5);
    await db.execute(sql`UPDATE support_login_throttle SET locked_until = now() - interval '1 minute', window_started_at = now() - interval '16 minutes'`);
    const res = await attempt(POST, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^support_session=\d+\.[0-9a-f]{64}; /);
    expect(await row()).toBeUndefined();
  });

  it("a live lock outlasts the 15-minute window: locking late in a window still lasts 15 minutes", async () => {
    await fail(POST, 5);
    await db.execute(sql`UPDATE support_login_throttle SET window_started_at = now() - interval '16 minutes'`);
    expect((await attempt(POST, PASSWORD)).status).toBe(429);
  });

  it("a refused attempt does not extend the lock", async () => {
    await fail(POST, 5);
    const before = (await row()).lockedUntil!.getTime();
    await attempt(POST, "nope");
    await attempt(POST, PASSWORD);
    expect((await row()).lockedUntil!.getTime()).toBe(before);
  });

  it("a window older than 15 minutes restarts the count at 1 instead of locking", async () => {
    await fail(POST, 4);
    await db.execute(sql`UPDATE support_login_throttle SET window_started_at = now() - interval '16 minutes'`);
    await fail(POST, 1);
    const r = await row();
    expect(r.failures).toBe(1);
    expect(r.lockedUntil).toBeNull();
    expect(Date.now() - r.windowStartedAt.getTime()).toBeLessThan(60_000);
  });

  it("a window inside 15 minutes keeps counting from its original start", async () => {
    await fail(POST, 2);
    const before = (await row()).windowStartedAt.getTime();
    await fail(POST, 1);
    const r = await row();
    expect(r.failures).toBe(3);
    expect(r.windowStartedAt.getTime()).toBe(before);
  });

  it("a success deletes the row, so the next wrong password counts from 1", async () => {
    await fail(POST, 4);
    expect((await attempt(POST, PASSWORD)).status).toBe(200);
    expect(await row()).toBeUndefined();
    await fail(POST, 1);
    expect((await row()).failures).toBe(1);
  });

  it("a success clears only its own IP's row", async () => {
    await fail(POST, 2, "198.51.100.1");
    await fail(POST, 2, "198.51.100.2");
    expect((await attempt(POST, PASSWORD, "198.51.100.1")).status).toBe(200);
    expect(await row("198.51.100.1")).toBeUndefined();
    expect((await row("198.51.100.2")).failures).toBe(2);
  });

  it("10 concurrent wrong attempts from one IP: at most 5 are compared, the rest are locked out", async () => {
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => attempt(POST, "nope")))).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect((await attempt(POST, PASSWORD)).status).toBe(429);
  });

  it("a burst split across two instances is still capped at 5 compared attempts", async () => {
    vi.resetModules();
    const second = (await import("../app/api/support/login/route")).POST;
    const calls = Array.from({ length: 12 }, (_, i) => attempt(i % 2 ? second : POST, "nope"));
    const statuses = (await Promise.all(calls)).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
  });

  it("each IP has its own counter: one locked IP does not lock another", async () => {
    await fail(POST, 5, "198.51.100.1");
    expect((await attempt(POST, PASSWORD, "198.51.100.1")).status).toBe(429);
    expect((await attempt(POST, PASSWORD, "198.51.100.2")).status).toBe(200);
  });

  it("the lock is shared by a second server instance (own module graph and pool)", async () => {
    await fail(POST, 5);
    vi.resetModules();
    const second = (await import("../app/api/support/login/route")).POST;
    expect(second).not.toBe(POST);
    const res = await attempt(second, PASSWORD);
    expect(res.status).toBe(429);
  });

  it("failures recorded by two instances add up", async () => {
    vi.resetModules();
    const second = (await import("../app/api/support/login/route")).POST;
    await fail(POST, 3);
    await fail(second, 2);
    expect((await row()).failures).toBe(5);
    expect((await attempt(POST, PASSWORD)).status).toBe(429);
  });
});

describe("support inbox list e2e", () => {
  const T0 = Date.parse("2026-11-09T12:00:00Z");
  const seed = (n: number, status: string, category: string, role: string, hoursAgo: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    username: `user${n}`,
    role,
    category,
    text: `comment ${n}`,
    route: "/x",
    screenLabel: "Pantalla",
    createdAt: new Date(T0 - hoursAgo * 3_600_000),
    status,
  });
  const ids = (rows: { id: string }[]) => rows.map((r) => Number(r.id.slice(-1)));

  beforeEach(async () => {
    // Inserted out of order on purpose: newest first must come from ORDER BY, not insertion order.
    await db.insert(supportFeedback).values([
      seed(3, "leido", "bug", "tecnico", 3),
      seed(5, "resuelto", "other", "administrador", 5),
      seed(1, "nuevo", "bug", "tecnico", 1),
      seed(4, "leido", "idea", "tecnico", 4),
      seed(2, "nuevo", "idea", "jefe_taller", 2),
    ]);
  });

  it("lists newest first by created_at", async () => {
    expect(ids(await listFeedback({}))).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts every status with one GROUP BY, and zero for a status with no rows", async () => {
    expect(await statusCounts()).toEqual({ nuevo: 2, leido: 2, resuelto: 1 });
    await db.delete(supportFeedback).where(eq(supportFeedback.status, "resuelto"));
    expect(await statusCounts()).toEqual({ nuevo: 2, leido: 2, resuelto: 0 });
  });

  it("the status filter is a WHERE", async () => {
    expect(ids(await listFeedback({ status: "leido" }))).toEqual([3, 4]);
  });

  it("the category filter is a WHERE", async () => {
    expect(ids(await listFeedback({ category: "idea" }))).toEqual([2, 4]);
  });

  it("the role filter is a WHERE", async () => {
    expect(ids(await listFeedback({ role: "administrador" }))).toEqual([5]);
  });

  it("filters combine with AND: category bug AND role tecnico", async () => {
    expect(ids(await listFeedback({ category: "bug", role: "tecnico" }))).toEqual([1, 3]);
  });

  it("all three filters together narrow to one row", async () => {
    expect(ids(await listFeedback({ status: "nuevo", category: "bug", role: "tecnico" }))).toEqual([1]);
  });

  it("a combination matching nothing returns no rows, while the counts still see the whole inbox", async () => {
    expect(await listFeedback({ status: "resuelto", role: "tecnico" })).toEqual([]);
    expect(await statusCounts()).toEqual({ nuevo: 2, leido: 2, resuelto: 1 });
  });

  it("listing and counting change no status", async () => {
    await listFeedback({});
    await listFeedback({ status: "nuevo" });
    await statusCounts();
    expect((await db.select().from(supportFeedback).where(eq(supportFeedback.status, "nuevo"))).length).toBe(2);
  });
});
