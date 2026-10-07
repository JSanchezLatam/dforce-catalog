/**
 * portal-sync/snapshot.ts — the payload pushed to the customer portal
 * (customer-portal WU5a, spec "Payload Whitelist"). Pure.
 *
 * Every output field is written out by name. There is no spread of a row
 * anywhere in this file and there must never be one: a column added to
 * `cliente`, `vehiculo` or `orden_servicio` later reaches the internet only if
 * somebody types it here, and `snapshot.test.ts` populates every forbidden
 * column with a sentinel to prove it does not.
 */
import { createHash } from "node:crypto";

import type { IngestBody, PortalOrder, PortalVehicle } from "@portal/contract";
import { CATEGORIA_LABEL } from "@/modules/service-orders/categories";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import type { Cliente, OrdenServicio, Vehiculo } from "@/shared/db/schema";

/** Typed `Record<OrderStatus, …>`: a sixth internal status is a compile error, not a leaked string. */
const CUSTOMER_STATUS: Record<OrderStatus, PortalOrder["status"]> = {
  open: "Recibida",
  in_progress: "En proceso",
  ready_for_review: "En proceso",
  done: "Terminada",
  cancelled: "Cancelada",
};

export type SnapshotInput = {
  cliente: Pick<Cliente, "id" | "portalToken">;
  vehicles: Pick<Vehiculo, "id" | "plate" | "make" | "model" | "year" | "deactivatedAt">[];
  orders: Pick<
    OrdenServicio,
    | "id"
    | "vehiculoId"
    | "status"
    | "categoria"
    | "createdAt"
    | "appointmentAt"
    | "completedAt"
    | "description"
    | "hallazgos"
    | "recomendaciones"
  >[];
};

export type UpsertBody = Extract<IngestBody, { kind: "upsert" }>;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A customer without a token is never upserted (see `decideSync`), so reaching here without one is a bug. */
export function buildSnapshot(input: SnapshotInput, version: number, now: Date): UpsertBody {
  if (!input.cliente.portalToken) throw new Error(`portal-sync: cliente ${input.cliente.id} has no portal token`);
  const vehicles: PortalVehicle[] = input.vehicles
    .filter((v) => v.deactivatedAt === null)
    .map((v) => ({
      id: v.id,
      plate: v.plate,
      make: v.make,
      model: v.model,
      year: v.year,
      orders: input.orders
        .filter((o) => o.vehiculoId === v.id)
        .map((o) => ({
          id: o.id,
          status: CUSTOMER_STATUS[o.status],
          categoria: CATEGORIA_LABEL[o.categoria],
          createdAt: o.createdAt.toISOString(),
          appointmentAt: iso(o.appointmentAt),
          completedAt: iso(o.completedAt),
          description: o.description,
          hallazgos: o.hallazgos,
          recomendaciones: o.recomendaciones,
        })),
    }));

  return {
    kind: "upsert",
    clienteId: input.cliente.id,
    version,
    tokenHash: hashToken(input.cliente.portalToken),
    generatedAt: now.toISOString(),
    vehicles,
  };
}
