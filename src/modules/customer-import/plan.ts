/**
 * Decides INSERT/UPDATE/SKIP per mapped row, per design D3. Pure — no DB
 * access, no `@/shared/db/client` import, no async. This is the last place
 * in the import that can be tested exhaustively without Postgres; the DB
 * seam is a later work unit.
 *
 * Deliberately does NOT import the Drizzle `Cliente` type: that table is
 * being edited elsewhere while this file is written, and the planner only
 * ever needs a row's `id` and `externalId`.
 */

import type { MappedRow, SkippedCustomer } from "./mapper";

export type LocalCustomer = {
  id: string;
  externalId: string | null;
};

/**
 * Exactly the fields Interfuerza owns. Never add `whatsappOptOut`,
 * `emailOptOut`, `deactivatedAt`, or anything about vehicles here — those
 * are this app's state, and a re-import must not touch them (D3, R21).
 */
export type CustomerPatch = {
  name: string;
  phone: string;
  email: string | null;
};

export type PlannedInsert = {
  kind: "insert";
  externalId: string;
  data: CustomerPatch;
};

export type PlannedUpdate = {
  kind: "update";
  id: string;
  externalId: string;
  patch: CustomerPatch;
};

export type PlannedRow = PlannedInsert | PlannedUpdate | SkippedCustomer;

export function planImport(rows: MappedRow[], existing: LocalCustomer[]): PlannedRow[] {
  const localByExternalId = new Map<string, LocalCustomer>();
  for (const customer of existing) {
    // A `null` externalId means "created through the app, never imported" —
    // it must never be a match target, so it is never inserted into the map.
    if (customer.externalId !== null) {
      localByExternalId.set(customer.externalId, customer);
    }
  }

  return rows.map((row): PlannedRow => {
    if (row.kind === "skip") return row;

    const patch: CustomerPatch = { name: row.name, phone: row.phone, email: row.email };
    const match = localByExternalId.get(row.externalId);

    return match
      ? { kind: "update", id: match.id, externalId: row.externalId, patch }
      : { kind: "insert", externalId: row.externalId, data: patch };
  });
}
