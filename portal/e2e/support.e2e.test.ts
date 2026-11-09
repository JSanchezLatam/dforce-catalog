/**
 * Real SQL, throwaway database (`dforce_portal_test`, never `dforce_portal`):
 *   DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_portal_test npm run test:e2e
 * Goes through the real login route: throttle upsert, window reset, lock, success delete
 * and the lock being shared by a second server instance (its own module graph and pool).
 */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../src/db/client";
import { supportLoginThrottle } from "../src/db/schema";

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
beforeEach(() => db.delete(supportLoginThrottle));
afterAll(() => db.delete(supportLoginThrottle));

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
    await db.execute(sql`UPDATE support_login_throttle SET locked_until = now() - interval '1 second'`);
    const res = await attempt(POST, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^support_session=\d+\.[0-9a-f]{64}; /);
    expect(await row()).toBeUndefined();
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
