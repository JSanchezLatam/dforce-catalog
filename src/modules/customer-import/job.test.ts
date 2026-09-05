import { describe, expect, it, vi } from "vitest";

import type { TxLike } from "@/modules/customers/vehicles";
import { InterfuerzaAbortError } from "@/shared/interfuerza/client";
import type { LocalCustomer } from "./plan";
import { runCustomerImport, type RunCustomerImportDeps } from "./job";

/**
 * Fake `tx`: records every insert/update call so assertions can check the
 * EXACT patch shape reaching the DB seam, not just planImport's pure output
 * (already covered in plan.test.ts) — this is the boundary where a stray
 * `whatsappOptOut`/`deactivatedAt` would actually reach Postgres.
 */
function fakeTx() {
  const inserted: unknown[] = [];
  const updated: { id: string; set: unknown }[] = [];
  const tx = {
    insert: () => ({
      values: async (values: unknown) => {
        inserted.push(values);
      },
    }),
    update: () => ({
      set: (set: unknown) => ({
        where: async () => {
          // `where` only ever receives `eq(cliente.id, id)` in job.ts — the id
          // itself isn't recoverable from the drizzle SQL object here, so the
          // planned row's `id` is threaded in by the caller below instead.
          updated.push({ id: "unknown", set });
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
    expect(updated).toEqual([{ id: "unknown", set: { name: "Beto", phone: "6222-2222", email: null } }]);
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
      transaction: async <T>(fn: (tx: TxLike) => Promise<T>) => fn({} as unknown as TxLike),
    };

    const result = await runCustomerImport({ fetchCustomers, database, listExisting });

    expect(fetchCustomers).toHaveBeenCalledTimes(1);
    expect(listExisting).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ created: 0, updated: 0, skipped: [] });
  });
});
