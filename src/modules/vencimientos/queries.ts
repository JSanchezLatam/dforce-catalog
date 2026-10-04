/**
 * vencimientos/queries.ts — SQL for the due list and the "Contactado" mark.
 *
 * SQL only FILTERS candidates (active vehicle of an active customer, with at
 * least one renewal field); the due rules live in `due.ts` and are pure. This
 * is a THIRD read-only import site for `vehiculo` (after `customers/vehicles.ts`
 * and `service-orders/queries.ts`): it joins `cliente` and `vehiculo_contacto`,
 * so it belongs to this feature rather than to `vehicles.ts`.
 *
 * SERVER-ONLY data lives here: `customerPhone` and `whatsappOptOut` are the
 * raw stored values. Nothing in this module may reach a client component.
 */
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { cliente, vehiculo, vehiculoContacto } from "@/shared/db/schema";
import type { VencimientoKind } from "./due";

export type DueCandidate = {
  vehiculoId: string;
  clienteId: string;
  customerName: string;
  /** Raw stored phone. Server-only: the page resolves it to a `wa.me` number before anything reaches a client. */
  customerPhone: string;
  /** Server-only: the page resolves it to a "blocked" reason; the flag itself never crosses to the client. */
  whatsappOptOut: boolean;
  make: string | null;
  model: string | null;
  plate: string;
  numeroUnidad: string | null;
  placaRenovacionMes: number | null;
  seguroVence: string | null;
};

export type ContactMark = { vehiculoId: string; kind: VencimientoKind; periodKey: string };

export type NewContacto = ContactMark & { contactedBy: string | null };

/** Active vehicles of active customers with at least one renewal field set. */
export async function listDueCandidates(): Promise<DueCandidate[]> {
  return db
    .select({
      vehiculoId: vehiculo.id,
      clienteId: cliente.id,
      customerName: cliente.name,
      customerPhone: cliente.phone,
      whatsappOptOut: cliente.whatsappOptOut,
      make: vehiculo.make,
      model: vehiculo.model,
      plate: vehiculo.plate,
      numeroUnidad: vehiculo.numeroUnidad,
      placaRenovacionMes: vehiculo.placaRenovacionMes,
      seguroVence: vehiculo.seguroVence,
    })
    .from(vehiculo)
    .innerJoin(cliente, eq(vehiculo.clienteId, cliente.id))
    .where(
      and(
        isNull(vehiculo.deactivatedAt),
        isNull(cliente.deactivatedAt),
        or(isNotNull(vehiculo.placaRenovacionMes), isNotNull(vehiculo.seguroVence)),
      ),
    );
}

/** Every mark, whole. ponytail: restrict by vehicle id if the table grows. */
export async function listContacts(): Promise<ContactMark[]> {
  return db
    .select({ vehiculoId: vehiculoContacto.vehiculoId, kind: vehiculoContacto.kind, periodKey: vehiculoContacto.periodKey })
    .from(vehiculoContacto);
}

export async function vehiculoExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: vehiculo.id }).from(vehiculo).where(eq(vehiculo.id, id)).limit(1);
  return rows.length > 0;
}

/** The parts of `db` this insert touches, so a unit test can hand in a recording fake. */
type ContactoInserter = {
  insert: (table: typeof vehiculoContacto) => {
    values: (row: NewContacto) => { onConflictDoNothing: () => PromiseLike<unknown> };
  };
};

/** The composite PK is the uniqueness rule: a second identical mark is a no-op, not an error. */
export async function insertContacto(row: NewContacto, database: ContactoInserter = db): Promise<void> {
  await database.insert(vehiculoContacto).values(row).onConflictDoNothing();
}
