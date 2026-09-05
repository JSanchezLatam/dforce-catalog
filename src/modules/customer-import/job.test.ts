import { Param, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { TxLike as BaseTxLike } from "@/modules/customers/vehicles";
import { InterfuerzaAbortError } from "@/shared/interfuerza/client";

// Widened the exact same way job.ts's own (module-local, unexported)
// `TxLike` is — with `execute`, needed by the layer-2 advisory lock statement.
type TxLike = BaseTxLike & { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> };
import type { LocalCustomer } from "./plan";
import {
  buildActiveImportRunQuery,
  hasActiveImportRun,
  ImportAlreadyRunningError,
  runCustomerImport,
  type RunCustomerImportDeps,
} from "./job";

/**
 * Fake `tx`: records every insert/update call so assertions can check the
 * EXACT patch shape reaching the DB seam, not just planImport's pure output
 * (already covered in plan.test.ts) — this is the boundary where a stray
 * `whatsappOptOut`/`deactivatedAt` would actually reach Postgres.
 *
 * `execute` is stubbed too — job.ts now issues `pg_advisory_xact_lock` as the
 * first statement inside the transaction (the concurrency fix's layer 2), so
 * any test whose fetch succeeds and reaches the transaction body needs this,
 * or it hits a real `tx.execute is not a function` at runtime.
 */
function fakeTx() {
  const inserted: unknown[] = [];
  const updated: { id: string; set: unknown }[] = [];
  const tx = {
    execute: async () => ({ rows: [] }),
    insert: () => ({
      values: async (values: unknown) => {
        inserted.push(values);
      },
    }),
    update: () => ({
      set: (set: unknown) => ({
        // `where` only ever receives `eq(cliente.id, id)` in job.ts. `eq(...)`
        // compiles to a drizzle `SQL` fragment whose bound value is wrapped in
        // drizzle's own (publicly exported) `Param` class inside
        // `queryChunks` — reading it back here is what lets the assertion
        // below prove the UPDATE targets the right row, instead of recording
        // a placeholder that would look identical no matter which id job.ts
        // actually passed in.
        where: async (condition: { queryChunks: unknown[] }) => {
          const param = condition.queryChunks.find(
            (chunk): chunk is InstanceType<typeof Param> => chunk instanceof Param,
          );
          updated.push({ id: String(param?.value), set });
        },
      }),
    }),
  };
  return { tx, inserted, updated };
}

function baseDeps(overrides: Partial<RunCustomerImportDeps> = {}): {
  deps: RunCustomerImportDeps;
  inserted: unknown[];
  updated: { id: string; set: unknown }[];
} {
  const { tx, inserted, updated } = fakeTx();
  const database = {
    transaction: async <T>(fn: (tx: TxLike) => Promise<T>) => fn(tx as unknown as TxLike),
  };
  const deps: RunCustomerImportDeps = {
    database,
    listExisting: async () => [],
    // Layer-1 bookkeeping (the "already running?" source of truth) is
    // orthogonal to what most of these tests exercise — stubbed to no-ops so
    // the default (real `db`) is never reached, same reasoning as
    // `defaultListExisting` in the "default deps" describe below: the real
    // `db` would try to open a Postgres connection this test suite doesn't
    // have (vitest.config.ts points DATABASE_URL at a nonexistent database).
    hasActiveImportRun: async () => false,
    startImportRun: async () => ({ id: "run-1" }),
    finishImportRun: async () => {},
    ...overrides,
  };
  return { deps, inserted, updated };
}

describe("runCustomerImport — insert, update and skip in one pass", () => {
  it("creates a new customer, updates an existing one by externalId, and reports the rest as skips", async () => {
    async function* fetchCustomers() {
      yield [
        { Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" },
        { Cliente: "2", Nombre: "Beto", Telefono_1: "6222-2222" },
      ];
      yield [{ Cliente: "3", Nombre: "Sin Telefono" }];
    }

    const existing: LocalCustomer[] = [{ id: "local-2", externalId: "2" }];
    const { deps, inserted, updated } = baseDeps({ fetchCustomers, listExisting: async () => existing });

    const result = await runCustomerImport(deps);

    expect(result).toEqual({
      created: 1,
      updated: 1,
      skipped: [{ externalId: "3", name: "Sin Telefono", reason: "missing_phone" }],
    });
    expect(inserted).toEqual([{ externalId: "1", name: "Rosa", phone: "6111-1111", email: null }]);
    expect(updated).toEqual([{ id: "local-2", set: { name: "Beto", phone: "6222-2222", email: null } }]);
  });

  it("never lets an update's patch carry whatsappOptOut, emailOptOut or deactivatedAt", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "2", Nombre: "Beto Nuevo", Telefono_1: "6222-9999" }];
    }
    const existing: LocalCustomer[] = [{ id: "local-2", externalId: "2" }];
    const { deps, updated } = baseDeps({ fetchCustomers, listExisting: async () => existing });

    await runCustomerImport(deps);

    expect(Object.keys(updated[0].set as object).sort()).toEqual(["email", "name", "phone"]);
  });

  it("reports zero created/updated and every skip when every row is unrepresentable", async () => {
    async function* fetchCustomers() {
      yield [{ Nombre: "Sin Id" }, { Cliente: "9" }];
    }
    const { deps, inserted, updated } = baseDeps({ fetchCustomers });

    const result = await runCustomerImport(deps);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([
      { externalId: null, name: "Sin Id", reason: "missing_external_id" },
      { externalId: "9", name: null, reason: "missing_name" },
    ]);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });
});

describe("runCustomerImport — an abort mid-run leaves nothing new to persist", () => {
  it("propagates InterfuerzaAbortError and never reaches the rows on a later page", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
      throw new InterfuerzaAbortError("customers page 2 failed after 3 attempts");
    }
    const { deps, inserted } = baseDeps({ fetchCustomers });

    await expect(runCustomerImport(deps)).rejects.toBeInstanceOf(InterfuerzaAbortError);

    // Real rollback of page 1's insert is `database.transaction()`'s own
    // guarantee (unverifiable under an injected fake, same limit
    // `inventory-sync/job.test.ts` documents) — what this proves is that the
    // callback itself throws before planning or applying anything further,
    // so page 1's row was inserted at most once and no update ever ran.
    expect(inserted.length).toBeLessThanOrEqual(1);
  });

  it("never opens the transaction at all when a later page aborts, so no write is ever attempted", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
      throw new InterfuerzaAbortError("customers page 2 failed after 3 attempts");
    }
    // `vi.fn()` erases the generic on `database.transaction`'s signature, so
    // this uses a plain counter instead of a spy to stay type-correct.
    let transactionCalls = 0;
    const deps: RunCustomerImportDeps = {
      fetchCustomers,
      database: {
        transaction: async <T>(fn: (tx: TxLike) => Promise<T>): Promise<T> => {
          transactionCalls++;
          return fn({} as unknown as TxLike);
        },
      },
      listExisting: async () => [],
      hasActiveImportRun: async () => false,
      startImportRun: async () => ({ id: "run-1" }),
      finishImportRun: async () => {},
    };

    await expect(runCustomerImport(deps)).rejects.toBeInstanceOf(InterfuerzaAbortError);

    // Fetch/map now run before the transaction opens (design.md D6 does not
    // require the fetch itself to be transactional — only the writes). If
    // this ever regresses back to fetching inside the transaction, this is
    // the assertion that catches it: no connection was ever opened for a
    // page-2 abort, let alone held idle-in-transaction for it.
    expect(transactionCalls).toBe(0);
  });
});

describe("runCustomerImport — default deps", () => {
  it("calls the given fetchCustomers and listExisting exactly once each, not zero and not per-row", async () => {
    // This does NOT exercise the `?? fetchAllCustomers` / `?? db` /
    // `?? defaultListExisting` defaults — every dep below is given, so the
    // defaults are never reached. `defaultListExisting` is the only
    // hand-written `tx.select(...).from(cliente)` in this module; per
    // AGENTS.md's injected-seam coverage limit, its only real coverage is
    // the E2E "customer import (E2E)" describe in
    // `src/e2e/full-flow.e2e.test.ts`, which deliberately leaves
    // `database`/`listExisting` at their real defaults and injects only
    // `fetchCustomers`.
    const fetchCustomers = vi.fn(async function* () {
      yield [];
    });
    const listExisting = vi.fn(async () => []);
    const database = {
      transaction: async <T>(fn: (tx: TxLike) => Promise<T>) =>
        fn({ execute: async () => ({ rows: [] }) } as unknown as TxLike),
    };

    const result = await runCustomerImport({
      fetchCustomers,
      database,
      listExisting,
      hasActiveImportRun: async () => false,
      startImportRun: async () => ({ id: "run-1" }),
      finishImportRun: async () => {},
    });

    expect(fetchCustomers).toHaveBeenCalledTimes(1);
    expect(listExisting).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 0, updated: 0, skipped: [] });
  });
});

describe("hasActiveImportRun — layer 1's own query (best-effort, not the guarantee)", () => {
  it("reflects whatever the query returns", async () => {
    await expect(hasActiveImportRun(async () => [{ id: "run-1" }])).resolves.toBe(true);
    await expect(hasActiveImportRun(async () => [])).resolves.toBe(false);
  });
});

describe("hasActiveImportRun — default query bounds `running` by age (finding 1)", () => {
  it("bounds the default query to status = 'running' AND startedAt within the window, not status alone", () => {
    // A killed process (deploy, OOM, host reaping a long request) between
    // `startRun()` and `finishRun` leaves a `running` row forever. Without a
    // time bound, `hasActiveImportRun`'s default query answers 409 forever
    // for a run that died last week. `buildActiveImportRunQuery` is a pure
    // query BUILDER (not executed) so this can inspect its compiled SQL via
    // drizzle's own `.toSQL()` without a live Postgres connection — same
    // "no real DB reachable under `npm test`" constraint AGENTS.md documents
    // for this module's other real-SQL defaults.
    const { sql: compiled } = buildActiveImportRunQuery().toSQL();

    expect(compiled).toMatch(/"status" = \$1/);
    expect(compiled).toMatch(/"started_at" > now\(\) - interval '45 minutes'/);
  });
});

describe("runCustomerImport — layer 1: fast rejection BEFORE the fetch (best-effort, TOCTOU-prone on its own)", () => {
  it("rejects with ImportAlreadyRunningError and never calls fetchCustomers when a run is already in progress", async () => {
    const fetchCustomers = vi.fn(async function* () {
      yield [];
    });
    const { deps } = baseDeps({ fetchCustomers, hasActiveImportRun: async () => true });

    await expect(runCustomerImport(deps)).rejects.toBeInstanceOf(ImportAlreadyRunningError);

    // The whole point of layer 1: reject BEFORE spending another ~15
    // Interfuerza requests against an API this repo's docstrings describe as
    // carrying a real 1h IP ban.
    expect(fetchCustomers).not.toHaveBeenCalled();
  });
});

describe("runCustomerImport — layer 2: pg_advisory_xact_lock is the actual correctness guarantee", () => {
  it("takes the lock as the very first statement inside the write transaction, before listExisting reads anything", async () => {
    const order: string[] = [];
    const tx = {
      execute: vi.fn(async () => {
        order.push("lock");
        return { rows: [] };
      }),
      insert: () => ({
        values: async () => {
          order.push("insert");
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            order.push("update");
          },
        }),
      }),
    };
    const database = {
      transaction: async <T>(fn: (tx: TxLike) => Promise<T>): Promise<T> => fn(tx as unknown as TxLike),
    };
    const listExisting = vi.fn(async () => {
      order.push("listExisting");
      return [] as LocalCustomer[];
    });
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
    }

    await runCustomerImport({
      fetchCustomers,
      database,
      listExisting,
      hasActiveImportRun: async () => false,
      startImportRun: async () => ({ id: "run-1" }),
      finishImportRun: async () => {},
    });

    // Exactly one lock acquisition, and it happens before listExisting and
    // before any write — this ordering (lock BEFORE the read that plans
    // insert-vs-update) is what makes a second concurrent transaction block
    // until this one commits, then see the committed rows instead of racing
    // past them under READ COMMITTED. Verifying the actual cross-connection
    // serialization needs a live Postgres instance (same integration gap
    // `inventory-sync`/`pdf-generation` already document).
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("lock");
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("listExisting"));
    expect(order.indexOf("listExisting")).toBeLessThan(order.indexOf("insert"));
  });
});

describe("runCustomerImport — run bookkeeping backs layer 1's source of truth", () => {
  it("marks the run completed with created/updated/skippedCount after a successful import", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
    }
    const finishImportRun = vi.fn(async () => {});
    const { deps } = baseDeps({
      fetchCustomers,
      startImportRun: async () => ({ id: "run-42" }),
      finishImportRun,
    });

    const result = await runCustomerImport(deps);

    expect(finishImportRun).toHaveBeenCalledWith(
      "run-42",
      expect.objectContaining({
        status: "completed",
        created: result.created,
        updated: result.updated,
        skippedCount: result.skipped.length,
      }),
    );
  });

  it("marks the run failed (never completed) and still rethrows when the write transaction throws", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
    }
    const finishImportRun = vi.fn(async () => {});
    const boom = new Error("boom");
    const deps: RunCustomerImportDeps = {
      fetchCustomers,
      database: { transaction: async () => Promise.reject(boom) },
      listExisting: async () => [],
      hasActiveImportRun: async () => false,
      startImportRun: async () => ({ id: "run-42" }),
      finishImportRun,
    };

    await expect(runCustomerImport(deps)).rejects.toThrow("boom");

    expect(finishImportRun).toHaveBeenCalledWith(
      "run-42",
      expect.objectContaining({ status: "failed", error: expect.stringContaining("boom") }),
    );
  });

  it("propagates the ORIGINAL error, not finishRun's own rejection, when the catch-path bookkeeping itself throws (finding 2)", async () => {
    async function* fetchCustomers() {
      yield [{ Cliente: "1", Nombre: "Rosa", Telefono_1: "6111-1111" }];
    }
    const originalError = new Error("original transaction failure");
    const bookkeepingError = new Error("finishImportRun DB write failed");
    const deps: RunCustomerImportDeps = {
      fetchCustomers,
      database: { transaction: async () => Promise.reject(originalError) },
      listExisting: async () => [],
      hasActiveImportRun: async () => false,
      startImportRun: async () => ({ id: "run-42" }),
      finishImportRun: async () => {
        throw bookkeepingError;
      },
    };

    await expect(runCustomerImport(deps)).rejects.toBe(originalError);
  });
});
