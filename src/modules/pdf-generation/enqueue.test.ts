import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { db } from "@/shared/db/client";

import {
  enqueueCatalogPdf,
  MAX_QUEUE_DEPTH,
  PDF_GENERATE_JOB,
  PDF_GENERATE_RETRY,
  QueueFullError,
  type PdfGeneratePayload,
} from "./enqueue";

const PAYLOAD: PdfGeneratePayload = {
  catalogId: "cat-1",
  userId: "user-1",
  title: "Catalog: Motor",
  branding: null,
  sections: [],
  products: [],
  productsPerPage: 10,
};

/**
 * Fake `db.transaction` matching drizzle's shape: runs the callback with a
 * fake tx, returns its result. `enqueueCatalogPdf` always issues exactly two
 * `tx.execute()` calls in order — advisory lock, then depth count — so a
 * call-order counter is enough to fake both without parsing the SQL object.
 */
function fakeDatabase(depth: number) {
  let calls = 0;
  const tx = {
    execute: vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { rows: [] }; // pg_advisory_xact_lock
      return { rows: [{ count: depth }] }; // count(*) query
    }),
    // Every test injects `createPendingCatalog`; reaching the tx's own insert
    // would mean the injected seam was bypassed.
    insert: (() => {
      throw new Error("unexpected tx.insert — inject createPendingCatalog");
    }) as unknown as typeof db.insert,
  };
  const database = {
    transaction: async <T>(fn: (transactionTx: typeof tx) => Promise<T>) => fn(tx),
  };
  return { database, tx, executed: () => tx.execute.mock.calls.length };
}

describe("enqueueCatalogPdf — Risk-2 depth cap", () => {
  it("enqueues when depth is under MAX_QUEUE_DEPTH", async () => {
    const { database, executed } = fakeDatabase(1);
    const send = vi.fn().mockResolvedValue("job-123");
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { send, createQueue } as unknown as PgBoss;

    const result = await enqueueCatalogPdf(PAYLOAD, {
      getBoss: async () => boss,
      database,
      createPendingCatalog: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({ jobId: "job-123" });
    expect(send).toHaveBeenCalledWith(PDF_GENERATE_JOB, PAYLOAD, PDF_GENERATE_RETRY);
    // Exactly 2 tx.execute() calls: advisory lock, then depth count — that
    // ordering (lock BEFORE count, both inside the same transaction) is what
    // makes the guarantee hold under real concurrent Postgres transactions.
    // Verifying the actual cross-connection serialization needs a real
    // Postgres instance — deferred, same integration gap flagged since
    // PR2/PR3.
    expect(executed()).toBe(2);
  });

  it.each([MAX_QUEUE_DEPTH, MAX_QUEUE_DEPTH + 1])("rejects with QueueFullError and never sends when depth is %i", async (depth) => {
    const { database } = fakeDatabase(depth);
    const send = vi.fn();
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { send, createQueue } as unknown as PgBoss;

    const createPendingCatalog = vi.fn();

    await expect(
      enqueueCatalogPdf(PAYLOAD, { getBoss: async () => boss, database, createPendingCatalog }),
    ).rejects.toBeInstanceOf(QueueFullError);
    expect(send).not.toHaveBeenCalled();
    // A refused request must leave nothing on /catalogs to explain.
    expect(createPendingCatalog).not.toHaveBeenCalled();
  });

  it("enqueues right at the boundary (depth = MAX_QUEUE_DEPTH - 1)", async () => {
    const { database } = fakeDatabase(MAX_QUEUE_DEPTH - 1);
    const send = vi.fn().mockResolvedValue("job-124");
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { send, createQueue } as unknown as PgBoss;

    await expect(
      enqueueCatalogPdf(PAYLOAD, { getBoss: async () => boss, database, createPendingCatalog: vi.fn() }),
    ).resolves.toEqual({
      jobId: "job-124",
    });
  });

  it("throws when pg-boss's send() unexpectedly returns null", async () => {
    const { database } = fakeDatabase(0);
    const send = vi.fn().mockResolvedValue(null);
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const boss = { send, createQueue } as unknown as PgBoss;

    await expect(
      enqueueCatalogPdf(PAYLOAD, { getBoss: async () => boss, database, createPendingCatalog: vi.fn() }),
    ).rejects.toThrow(
      "pg-boss rejected",
    );
  });
});

/**
 * The `catalogs` row used to be inserted by the WORKER, after the render. An
 * operator who opened /catalogs right after Generar saw nothing, and a render
 * that failed left nothing to mark failed. The row is now born here, at
 * enqueue — inside the advisory-locked transaction, so a send that throws
 * rolls it back with everything else. That rollback is Postgres's, not this
 * fake's: `full-flow.e2e.test.ts` is where it is proven.
 */
describe("enqueueCatalogPdf — the catalogs row is created at enqueue", () => {
  it("inserts the pending row through the locked transaction, after the depth check and before the send", async () => {
    const { database, tx, executed } = fakeDatabase(0);
    const order: string[] = [];
    const createPendingCatalog = vi.fn(async () => {
      order.push(`insert after ${executed()} executes`);
    });
    const send = vi.fn(async () => {
      order.push("send");
      return "job-9";
    });
    const boss = { send, createQueue: vi.fn().mockResolvedValue(undefined) } as unknown as PgBoss;

    await enqueueCatalogPdf(PAYLOAD, { getBoss: async () => boss, database, createPendingCatalog });

    expect(createPendingCatalog).toHaveBeenCalledWith(PAYLOAD, tx);
    expect(order).toEqual(["insert after 2 executes", "send"]);
  });

  it("lets a send failure escape the transaction, so the row is rolled back with it", async () => {
    const { database } = fakeDatabase(0);
    const createPendingCatalog = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error("pg-boss down"));
    const boss = { send, createQueue: vi.fn().mockResolvedValue(undefined) } as unknown as PgBoss;

    await expect(enqueueCatalogPdf(PAYLOAD, { getBoss: async () => boss, database, createPendingCatalog })).rejects.toThrow(
      "pg-boss down",
    );
    expect(createPendingCatalog).toHaveBeenCalledTimes(1);
  });
});
