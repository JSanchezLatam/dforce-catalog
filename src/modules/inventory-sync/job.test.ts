import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";
import { SyncAbortError } from "./client";
import {
  hasActiveSyncRun,
  INVENTORY_SYNC_JOB,
  registerInventorySyncWorker,
  requestManualSync,
  runSync,
  SyncAlreadyRunningError,
} from "./job";

// WU4 (design.md decision 18) — capture.ts's withJobCapture defaults its
// `report` param to Sentry.captureException; mocking it here lets the
// registerInventorySyncWorker test below assert on the real wiring without
// a live Sentry transport. vi.hoisted is required because "./job" above is
// a STATIC import that resolves "@sentry/nextjs" via capture.ts before any
// later bare top-level const would run (see reminders/job.test.ts's fuller
// comment on this exact TDZ trap).
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("requestManualSync — Risk-6 explicit active-run check (R2.5)", () => {
  it("rejects with SyncAlreadyRunningError and never enqueues when a sync is already running", async () => {
    const send = vi.fn();
    const createQueue = vi.fn();
    const boss = { send, createQueue } as unknown as PgBoss;

    await expect(
      requestManualSync("admin-1", {}, { hasActiveSyncRun: async () => true, getBoss: async () => boss }),
    ).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    expect(send).not.toHaveBeenCalled();
  });

  it("enqueues with a singletonKey guard when no sync is running", async () => {
    const send = vi.fn().mockResolvedValue("job-1");
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { send, createQueue } as unknown as PgBoss;

    await requestManualSync(
      "admin-1",
      { l1: "Motor" },
      { hasActiveSyncRun: async () => false, getBoss: async () => boss },
    );

    expect(createQueue).toHaveBeenCalledWith(INVENTORY_SYNC_JOB);
    expect(send).toHaveBeenCalledWith(
      INVENTORY_SYNC_JOB,
      { mode: "manual", filters: { l1: "Motor" }, triggeredBy: "admin-1" },
      expect.objectContaining({ singletonKey: INVENTORY_SYNC_JOB }),
    );
  });
});

describe("registerInventorySyncWorker", () => {
  it("wraps the boss.work handler with withJobCapture: a throw is reported with job/jobId tags and pg-boss still sees the rejection", async () => {
    captureException.mockClear();
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, work } as unknown as PgBoss;

    await registerInventorySyncWorker({ getBoss: async () => boss });

    expect(work).toHaveBeenCalledWith(INVENTORY_SYNC_JOB, { localConcurrency: 1 }, expect.any(Function));
    const registeredHandler = work.mock.calls[0][2] as (jobs: unknown[]) => Promise<void>;
    // Empty jobs array: the site's `async ([job]) => ...` destructures
    // `job` as undefined, so `job.data` throws synchronously — a
    // deterministic failure that needs no real DB.
    await expect(registeredHandler([])).rejects.toBeInstanceOf(TypeError);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(TypeError), {
      tags: { job: INVENTORY_SYNC_JOB, jobId: "unknown" },
    });
  });
});

describe("hasActiveSyncRun", () => {
  it("reflects whatever the query returns", async () => {
    await expect(hasActiveSyncRun(async () => [{ id: "run-1" }])).resolves.toBe(true);
    await expect(hasActiveSyncRun(async () => [])).resolves.toBe(false);
  });
});

describe("runSync — no partial write on abort (R1.9)", () => {
  it("marks the sync_runs row failed (never completed) when a page aborts mid-run", async () => {
    async function* fakePages() {
      // 5-key wrapper shape (mapper.ts's real, unmocked parseProduct runs
      // against these fixtures) — see interfuerza-api-contract-fix PR3.
      yield [{ Producto: { id: "1", Nombre: "A" }, InStock: [], PriceLists: [], Images: [], Matrix: [] }];
      throw new SyncAbortError("page 2 failed after 3 attempts");
    }

    const insertedInTx: unknown[] = [];
    const tx = {
      insert: () => ({
        values: (values: unknown) => {
          insertedInTx.push(values);
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
    };

    const run = { status: "running", error: undefined as string | undefined, productCount: undefined as number | undefined };
    const fakeDb = {
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: "run-1" }],
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn(tx),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => Object.assign(run, patch),
        }),
      }),
    };

    await expect(
      runSync(
        { mode: "manual" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { db: fakeDb as unknown as typeof db, fetchProducts: fakePages as any },
      ),
    ).rejects.toBeInstanceOf(SyncAbortError);

    // Only page 1's single item was ever attempted inside the transaction
    // callback; page 2 never ran. Whether that attempt is actually rolled
    // back at the Postgres level is db.transaction()'s own guarantee, not
    // re-verified here (deferred to an integration test against a real DB —
    // see apply-progress "Issues Found").
    expect(insertedInTx).toHaveLength(1);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("page 2 failed");
  });

  it("marks the sync_runs row completed with the correct product count on success", async () => {
    async function* fakePages() {
      // 5-key wrapper shape (mapper.ts's real, unmocked parseProduct runs
      // against these fixtures) — see interfuerza-api-contract-fix PR3.
      const wrap = (id: string) => ({ Producto: { id }, InStock: [], PriceLists: [], Images: [], Matrix: [] });
      yield [wrap("1"), wrap("2")];
      yield [wrap("3")];
    }

    const run = { status: "running", productCount: undefined as number | undefined };
    const fakeDb = {
      insert: () => ({
        values: () => ({ returning: async () => [{ id: "run-1" }] }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          insert: () => ({
            values: () => ({ onConflictDoUpdate: async () => undefined }),
          }),
        }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => Object.assign(run, patch),
        }),
      }),
    };

    await runSync(
      { mode: "auto" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { db: fakeDb as unknown as typeof db, fetchProducts: fakePages as any },
    );

    expect(run.status).toBe("completed");
    expect(run.productCount).toBe(3);
  });
});
