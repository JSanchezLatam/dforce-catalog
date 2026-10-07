/**
 * The only writer of `portal_customer`. Upsert and delete are ONE statement,
 * `INSERT ... ON CONFLICT (cliente_id) DO UPDATE ... WHERE version < excluded`,
 * so the version gate is atomic under concurrent deliveries (the second writer
 * re-checks the WHERE against the committed row). A delete is a tombstone: a
 * hard DELETE would let a delayed older upsert resurrect the customer.
 */
import { and, lt, notInArray, sql } from "drizzle-orm";

import type { IngestBody } from "../contract";
import { db } from "../db/client";
import { portalCustomer } from "../db/schema";

type Snapshot = NonNullable<typeof portalCustomer.$inferInsert.snapshot>;

async function gatedWrite(clienteId: string, version: number, tokenHash: string | null, snapshot: Snapshot | null) {
  const rows = await db
    .insert(portalCustomer)
    .values({ clienteId, version, tokenHash, snapshot })
    .onConflictDoUpdate({
      target: portalCustomer.clienteId,
      set: { version, tokenHash, snapshot, syncedAt: sql`now()` },
      setWhere: sql`${portalCustomer.version} < excluded.version`,
    })
    .returning({ clienteId: portalCustomer.clienteId });
  return { applied: rows.length > 0 };
}

export async function applyIngest(body: IngestBody): Promise<{ applied: boolean }> {
  switch (body.kind) {
    case "upsert":
      return gatedWrite(body.clienteId, body.version, body.tokenHash, {
        vehicles: body.vehicles,
        generatedAt: body.generatedAt,
      });
    case "delete":
      return gatedWrite(body.clienteId, body.version, null, null);
    case "reconcile":
      // ponytail: one parameter per live id, so ~65k customers is the ceiling
      // (pg bind limit); a workshop is far below it. Chunk or `<> ALL($1::text[])` past that.
      await db
        .delete(portalCustomer)
        .where(and(notInArray(portalCustomer.clienteId, body.liveClienteIds), lt(portalCustomer.version, body.maxVersion)));
      return { applied: true };
  }
}
