import { eq } from "drizzle-orm";

import type { TxLike } from "@/modules/customers/vehicles";
import { db } from "@/shared/db/client";
import { cliente } from "@/shared/db/schema";
import { fetchAllCustomers } from "./client";
import { mapCustomerRow, type MappedRow, type SkipReason } from "./mapper";
import { planImport, type LocalCustomer } from "./plan";

/**
 * Runs the whole Interfuerza customer import. Fetch and mapping happen
 * BEFORE the transaction opens — design.md D6 only requires the WRITES to be
 * all-or-nothing, not the fetch itself. Draining every page with the
 * transaction open would hold a Postgres connection idle-in-transaction for
 * the whole fetch: 14 * `RATE_LIMIT_SPACING_MS` on the happy path, and up to
 * 2 * `RETRY_INTERVAL_MS` (120s) per retried page on a flaky one — inside a
 * synchronous HTTP request handler. With the fetch outside the transaction,
 * an `InterfuerzaAbortError` there leaves nothing persisted for free: no
 * write has happened yet. Once the transaction opens, `listExisting`, the
 * plan, and every insert/update are all inside it and either all commit or
 * none do (mirrors `inventory-sync/job.ts`'s `runSync`). A skip is not an
 * abort: the run completes and reports it (D5, R21).
 */

export type ImportSkip = { externalId: string | null; name: string | null; reason: SkipReason };
export type ImportResult = { created: number; updated: number; skipped: ImportSkip[] };

export type RunCustomerImportDeps = {
  fetchCustomers?: () => AsyncGenerator<unknown[]>;
  database?: { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> };
  listExisting?: (tx: TxLike) => Promise<LocalCustomer[]>;
};

async function defaultListExisting(tx: TxLike): Promise<LocalCustomer[]> {
  return tx.select({ id: cliente.id, externalId: cliente.externalId }).from(cliente);
}

export async function runCustomerImport(deps: RunCustomerImportDeps = {}): Promise<ImportResult> {
  const fetchCustomers = deps.fetchCustomers ?? fetchAllCustomers;
  const database = deps.database ?? db;
  const listExisting = deps.listExisting ?? defaultListExisting;

  const mapped: MappedRow[] = [];
  for await (const page of fetchCustomers()) {
    for (const raw of page) mapped.push(mapCustomerRow(raw));
  }

  return database.transaction(async (tx) => {
    // `listExisting` stays inside the transaction, alongside the writes: the
    // plan must be built against what this same transaction will see.
    const existing = await listExisting(tx);
    const plan = planImport(mapped, existing);

    let created = 0;
    let updated = 0;
    const skipped: ImportSkip[] = [];

    for (const row of plan) {
      if (row.kind === "skip") {
        skipped.push({ externalId: row.externalId, name: row.name, reason: row.reason });
      } else if (row.kind === "insert") {
        await tx.insert(cliente).values({ externalId: row.externalId, ...row.data });
        created++;
      } else {
        await tx.update(cliente).set(row.patch).where(eq(cliente.id, row.id));
        updated++;
      }
    }

    return { created, updated, skipped };
  });
}
