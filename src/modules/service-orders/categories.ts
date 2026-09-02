/**
 * service-orders/categories.ts — C4, design.md D3. `ServiceCategory` is the
 * single source of truth for `orden_servicio.categoria`'s TS type; `service.ts`
 * and every UI call site import it instead of re-deriving the union inline.
 *
 * REVISADO is Panama's mandatory annual ATTT technical inspection — a
 * billable service peer to the other four categories, not an order status
 * (spec §"Service Category Vocabulary"). Labels are the exact Spanish
 * strings staff read; `revisado` is displayed as the plain term, not a
 * lossy English translation.
 */
import { ordenCategoriaEnum } from "@/shared/db/schema";

export type ServiceCategory = (typeof ordenCategoriaEnum.enumValues)[number];

export const CATEGORIA_LABEL: Record<ServiceCategory, string> = {
  instalacion: "Instalación",
  mant_preventivo: "Mant. Preventivo",
  mant_correctivo: "Mant. Correctivo",
  reparacion: "Reparación",
  revisado: "REVISADO",
};

/**
 * The API is the trust boundary: `POST /api/service-orders` hands the raw
 * JSON body straight to `createOrder`, and PATCH copies `body.categoria`
 * into the patch, so TypeScript's `ServiceCategory` is a claim about that
 * body rather than a fact. Without this guard an unknown value reaches
 * Postgres and the caller gets a 500 where a 400 is owed — the same hole
 * `status` does NOT have, because `assertTransition` rejects it downstream.
 */
export function isServiceCategory(value: unknown): value is ServiceCategory {
  return typeof value === "string" && (ordenCategoriaEnum.enumValues as readonly string[]).includes(value);
}
