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

  // Index into `planned` for an external id already emitted as insert/update
  // IN THIS SAME PASS. Interfuerza paging is by page number against a `count`
  // snapshot (design.md), so a customer created or deleted mid-run shifts a
  // page boundary and the same `Cliente` value can arrive twice in one fetch.
  // `external_id` deliberately carries no unique index (D2), so nothing
  // downstream catches two inserts for the same id — the map must see its
  // own prior decision for that id and overwrite it in place, "last one
  // wins", rather than appending a second plan entry.
  const plannedIndexByExternalId = new Map<string, number>();
  const planned: PlannedRow[] = [];

  for (const row of rows) {
    if (row.kind === "skip") {
      planned.push(row);
      continue;
    }

    const patch: CustomerPatch = { name: row.name, phone: row.phone, email: row.email };
    const repeatIndex = plannedIndexByExternalId.get(row.externalId);

    if (repeatIndex !== undefined) {
      const previous = planned[repeatIndex] as PlannedInsert | PlannedUpdate;
      planned[repeatIndex] =
        previous.kind === "insert"
          ? { kind: "insert", externalId: row.externalId, data: patch }
          : { kind: "update", id: previous.id, externalId: row.externalId, patch };
      continue;
    }

    const match = localByExternalId.get(row.externalId);
    const result: PlannedRow = match
      ? { kind: "update", id: match.id, externalId: row.externalId, patch }
      : { kind: "insert", externalId: row.externalId, data: patch };

    plannedIndexByExternalId.set(row.externalId, planned.length);
    planned.push(result);
  }

  return planned;
}
