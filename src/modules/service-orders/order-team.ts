/**
 * service-orders/order-team.ts — who is on an order, for its detail page.
 *
 * No `scope` argument: the caller has already read the order through
 * `getOrdenServicioById(id, scope)`, so an order the viewer cannot see never
 * reaches this. A técnico sees the whole team of an order they are on.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { ordenLineaTrabajo, ordenTecnico, tecnico } from "@/shared/db/schema";

export type OrderAssignee = { tecnicoId: string; nombre: string; active: boolean; parteLista: boolean };

/** Assignment order (`assigned_at`), then name, so the list does not reshuffle on a refresh. */
export async function listOrderAssignees(ordenId: string): Promise<OrderAssignee[]> {
  const rows = await db
    .select({
      tecnicoId: tecnico.id,
      nombre: tecnico.nombre,
      deactivatedAt: tecnico.deactivatedAt,
      parteListaAt: ordenTecnico.parteListaAt,
    })
    .from(ordenTecnico)
    .innerJoin(tecnico, eq(ordenTecnico.tecnicoId, tecnico.id))
    .where(eq(ordenTecnico.ordenId, ordenId))
    .orderBy(asc(ordenTecnico.assignedAt), asc(tecnico.nombre));
  return rows.map((r) => ({
    tecnicoId: r.tecnicoId,
    nombre: r.nombre,
    active: r.deactivatedAt === null,
    parteLista: r.parteListaAt !== null,
  }));
}

/** `fecha` is the stored `YYYY-MM-DD` string (no timezone shift); minutes are the stored integer. */
export type OrderWorkLine = {
  id: string;
  tecnicoId: string;
  tecnicoNombre: string;
  descripcion: string;
  duracionMinutos: number;
  fecha: string;
};

/** Oldest day first, then entry order: a work log reads top to bottom. */
export async function listOrderLines(ordenId: string): Promise<OrderWorkLine[]> {
  return db
    .select({
      id: ordenLineaTrabajo.id,
      tecnicoId: ordenLineaTrabajo.tecnicoId,
      tecnicoNombre: tecnico.nombre,
      descripcion: ordenLineaTrabajo.descripcion,
      duracionMinutos: ordenLineaTrabajo.duracionMinutos,
      fecha: ordenLineaTrabajo.fecha,
    })
    .from(ordenLineaTrabajo)
    .innerJoin(tecnico, eq(ordenLineaTrabajo.tecnicoId, tecnico.id))
    .where(eq(ordenLineaTrabajo.ordenId, ordenId))
    .orderBy(asc(ordenLineaTrabajo.fecha), asc(ordenLineaTrabajo.createdAt));
}
