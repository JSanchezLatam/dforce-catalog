/**
 * Real-SQL proof for in-app-feedback WU4. The unit tests inject every seam, so
 * the claim's WHERE and lease, the delivered guard, the sweeper's due/oldest/
 * LIMIT and `listOwnFeedback`'s WHERE and ORDER never reach Postgres there.
 * They do here, on a THROWAWAY database — never the dev one. Only the HTTP
 * edge is replaced, with the portal's real response shapes.
 */
import { execSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { claimFeedback, deliverFeedback, markFeedbackDelivered, markFeedbackFailed } from "@/modules/feedback/deliver";
import { listOwnFeedback } from "@/modules/feedback/service";
import { runFeedbackSweep } from "@/modules/feedback/worker";
import { db } from "@/shared/db/client";
import { feedback, users } from "@/shared/db/schema";

const A = "e2e-fb-a";
const B = "e2e-fb-b";
const config = { url: "https://portal.example/api/ingest", secret: "e2e-secret" };

const respond = (status: number) => vi.fn<typeof fetch>(async () => new Response("{}", { status }));
const T = (iso: string) => new Date(iso);

describe("feedback outbox (E2E)", () => {
  const created: string[] = [];

  const insertRow = async (extra: Partial<typeof feedback.$inferInsert> = {}) => {
    const [row] = await db
      .insert(feedback)
      .values({ userId: A, username: A, role: "tecnico", category: "bug", text: "e2e", route: "/kanban", screenLabel: "Órdenes en curso", ...extra })
      .returning();
    created.push(row.id);
    return row;
  };
  const read = async (id: string) => (await db.select().from(feedback).where(eq(feedback.id, id)))[0];
  const minutesUntilDue = async (id: string) => {
    const { rows } = await db.execute<{ minutes: string }>(
      sql`SELECT extract(epoch FROM (next_attempt_at - now())) / 60 AS minutes FROM feedback WHERE id = ${id}`,
    );
    return Number(rows[0].minutes);
  };

  beforeAll(async () => {
    execSync("npx drizzle-kit migrate", { stdio: "inherit" });
    await db.insert(users).values([
      { id: A, username: A, passwordHash: "x", role: "tecnico" },
      { id: B, username: B, passwordHash: "x", role: "tecnico" },
    ]);
  }, 60_000);

  afterAll(async () => {
    await db.delete(feedback).where(inArray(feedback.userId, [A, B]));
    await db.delete(users).where(inArray(users.id, [A, B]));
  });

  it("inserts with defaults and enforces the 1..2000 CHECK", async () => {
    const row = await insertRow();
    expect(row).toMatchObject({ attempts: 0, deliveredAt: null, lastError: null });
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
    await insertRow({ text: "a".repeat(2000) });
    await expect(insertRow({ text: "a".repeat(2001) })).rejects.toThrow();
    await expect(insertRow({ text: "" })).rejects.toThrow();
  });

  it("concurrent claims of one due row have exactly one winner, and the claim counts the attempt", async () => {
    const row = await insertRow();
    const results = await Promise.all(Array.from({ length: 6 }, () => claimFeedback(row.id)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect((await read(row.id)).attempts).toBe(1);
  });

  it("leases the claimed row: it is not due again, so a second claim finds nothing", async () => {
    const row = await insertRow();
    expect(await claimFeedback(row.id)).not.toBeNull();
    expect(await claimFeedback(row.id)).toBeNull();
    const minutes = await minutesUntilDue(row.id);
    expect(minutes).toBeGreaterThan(1);
    expect(minutes).toBeLessThanOrEqual(2);
  });

  it("does not claim a not-yet-due row, nor a delivered one", async () => {
    const future = await insertRow({ nextAttemptAt: T("2999-01-01") });
    expect(await claimFeedback(future.id)).toBeNull();
    const delivered = await insertRow({ deliveredAt: T("2026-01-01") });
    expect(await claimFeedback(delivered.id)).toBeNull();
    expect((await read(future.id)).attempts).toBe(0);
    expect((await read(delivered.id)).attempts).toBe(0);
  });

  it("delivers through the real claim and marks delivered_at once", async () => {
    const row = await insertRow();
    const f = respond(200);
    expect(await deliverFeedback(row.id, 5_000, { config, fetch: f })).toBe("delivered");
    expect((await read(row.id)).deliveredAt).toBeInstanceOf(Date);
    expect(await deliverFeedback(row.id, 5_000, { config, fetch: f })).toBe("queued");
    expect(f).toHaveBeenCalledOnce();
  });

  it("a 5xx leaves the row undelivered with class and status only and a 1-minute backoff", async () => {
    const row = await insertRow({ text: "texto-secreto-del-usuario" });
    expect(await deliverFeedback(row.id, 5_000, { config, fetch: respond(503), report: () => {} })).toBe("queued");
    const after = await read(row.id);
    expect(after).toMatchObject({ deliveredAt: null, attempts: 1, lastError: "5xx 503" });
    const minutes = await minutesUntilDue(row.id);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(1);
  });

  it("the delivered guard: a late failure or a second success never overwrites a delivered row", async () => {
    const row = await insertRow({ deliveredAt: T("2026-01-01T00:00:00Z"), lastError: null });
    await markFeedbackFailed(row.id, { lastError: "5xx 503", delayMinutes: 60 });
    await markFeedbackDelivered(row.id);
    const after = await read(row.id);
    expect(after.lastError).toBeNull();
    expect(after.deliveredAt).toEqual(T("2026-01-01T00:00:00Z"));
    expect(after.nextAttemptAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it("the sweeper takes due undelivered rows only, oldest first, and honors the LIMIT", async () => {
    await db.delete(feedback).where(inArray(feedback.userId, [A, B]));
    const newest = await insertRow({ createdAt: T("2026-03-03") });
    const oldest = await insertRow({ createdAt: T("2026-03-01") });
    const middle = await insertRow({ createdAt: T("2026-03-02") });
    await insertRow({ createdAt: T("2026-03-04"), nextAttemptAt: T("2999-01-01") }); // not due
    await insertRow({ createdAt: T("2026-03-05"), deliveredAt: T("2026-03-06") }); // delivered

    const sent: string[] = [];
    await runFeedbackSweep({ config, send: async (_n, data) => void sent.push(data.id) });
    expect(sent).toEqual([oldest.id, middle.id, newest.id]);

    for (let i = 0; i < 27; i++) await insertRow({ createdAt: T("2026-04-01") });
    const capped: string[] = [];
    await runFeedbackSweep({ config, send: async (_n, data) => void capped.push(data.id) });
    expect(capped).toHaveLength(25);
    expect(capped.slice(0, 3)).toEqual([oldest.id, middle.id, newest.id]);
  });

  it("listOwnFeedback returns only the caller's rows, newest first, in SQL", async () => {
    await db.delete(feedback).where(inArray(feedback.userId, [A, B]));
    const old = await insertRow({ createdAt: T("2026-01-01") });
    const recent = await insertRow({ createdAt: T("2026-03-01") });
    const mid = await insertRow({ createdAt: T("2026-02-01") });
    const theirs = await insertRow({ userId: B, username: B, createdAt: T("2026-02-15") });
    expect((await listOwnFeedback(A)).map((r) => r.id)).toEqual([recent.id, mid.id, old.id]);
    expect((await listOwnFeedback(B)).map((r) => r.id)).toEqual([theirs.id]);
  });
});
