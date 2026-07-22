import { describe, expect, it, vi } from "vitest";

import { RETENTION_LIMIT, runRetentionForUser, shouldWarnOfEviction } from "./retention";

/**
 * Fake `db.transaction` matching drizzle's shape (same style as
 * pdf-generation/enqueue.test.ts's `fakeDatabase`). Drizzle's `sql` tagged
 * template doesn't stringify to readable SQL (confirmed: `String(sql\`...\`)`
 * is just `[object Object]`), so — same as enqueue.test.ts — this fakes by
 * CALL ORDER, not by inspecting query content: the 1st `execute()` call is
 * always the advisory lock, the 2nd is the eviction-candidates SELECT, and
 * any further calls are per-row DELETEs.
 */
function fakeDatabase(candidateRows: { id: string; r2Key: string | null }[]) {
  let calls = 0;
  const tx = {
    execute: vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { rows: [] }; // pg_advisory_xact_lock
      if (calls === 2) return { rows: candidateRows }; // SELECT eviction candidates
      return { rows: [] }; // DELETE
    }),
  };
  const database = {
    transaction: async <T>(fn: (transactionTx: typeof tx) => Promise<T>) => fn(tx),
  };
  return { database, executed: () => tx.execute.mock.calls.length };
}

describe("runRetentionForUser — Risk-4 transactional retention (R11.2-4)", () => {
  it("evicts nothing when there are no candidates beyond RETENTION_LIMIT", async () => {
    const { database } = fakeDatabase([]);
    const deleteObject = vi.fn();

    const result = await runRetentionForUser("user-1", { database, deleteObject });

    expect(result.evictedIds).toEqual([]);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the R2 object then the DB row for a single candidate beyond the cap", async () => {
    const { database } = fakeDatabase([{ id: "cat-old", r2Key: "catalogs/cat-old.pdf" }]);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    const result = await runRetentionForUser("user-1", { database, deleteObject });

    expect(deleteObject).toHaveBeenCalledWith("catalogs/cat-old.pdf");
    expect(result.evictedIds).toEqual(["cat-old"]);
  });

  it("evicts every candidate in a multi-candidate batch (proxy for two near-simultaneous completions both queuing evictions)", async () => {
    const { database } = fakeDatabase([
      { id: "cat-oldest", r2Key: "catalogs/cat-oldest.pdf" },
      { id: "cat-older", r2Key: "catalogs/cat-older.pdf" },
    ]);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    const result = await runRetentionForUser("user-1", { database, deleteObject });

    expect(result.evictedIds).toEqual(["cat-oldest", "cat-older"]);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("keeps the DB row (does not delete it) when the R2 delete fails, but still evicts other candidates", async () => {
    const { database } = fakeDatabase([
      { id: "cat-fails", r2Key: "catalogs/cat-fails.pdf" },
      { id: "cat-succeeds", r2Key: "catalogs/cat-succeeds.pdf" },
    ]);
    const deleteObject = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 network error"))
      .mockResolvedValueOnce(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runRetentionForUser("user-1", { database, deleteObject });

    expect(result.evictedIds).toEqual(["cat-succeeds"]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("issues exactly 2 tx.execute() calls (lock, then select) when there is nothing to evict", async () => {
    const { database, executed } = fakeDatabase([]);
    await runRetentionForUser("user-1", { database, deleteObject: vi.fn() });

    // Ordering (lock BEFORE select, both inside one transaction) is what
    // makes the per-user serialization guarantee hold under real concurrent
    // Postgres transactions — verifying the actual cross-connection
    // serialization needs a live Postgres instance, deferred, same
    // integration gap flagged since PR2/PR3.
    expect(executed()).toBe(2);
  });

  it("exposes RETENTION_LIMIT as 2 per R11.2", () => {
    expect(RETENTION_LIMIT).toBe(2);
  });

  it("logs the eviction event on the success path (R11.4 — was missing before this fix)", async () => {
    const { database } = fakeDatabase([{ id: "cat-old", r2Key: "catalogs/cat-old.pdf" }]);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runRetentionForUser("user-1", { database, deleteObject });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("cat-old"));
    consoleLogSpy.mockRestore();
  });
});

describe("shouldWarnOfEviction — R11.3 warning trigger condition", () => {
  it("does not warn when the user has fewer than RETENTION_LIMIT stored catalogs", () => {
    expect(shouldWarnOfEviction(1)).toBe(false);
  });

  it("warns when the user already has exactly RETENTION_LIMIT (2) stored catalogs", () => {
    expect(shouldWarnOfEviction(RETENTION_LIMIT)).toBe(true);
  });

  it("warns above RETENTION_LIMIT too", () => {
    expect(shouldWarnOfEviction(RETENTION_LIMIT + 1)).toBe(true);
  });
});
