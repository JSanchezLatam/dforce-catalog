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
import type { ordenCategoriaEnum } from "@/shared/db/schema";

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
  // Checked against CATEGORIA_LABEL's own keys rather than
  // `ordenCategoriaEnum.enumValues`, so the schema import above stays a TYPE
  // import and is fully erased. `ServiceOrderForm.tsx` is a "use client"
  // component that imports from this module; a value import here would be the
  // first runtime edge from the browser bundle into the Drizzle schema graph,
  // and whether that gets tree-shaken across the client boundary is a question
  // nothing in this repo measures. The map is exhaustive by its own
  // `Record<ServiceCategory, string>` type, so tsc keeps the two in step.
  // `Object.hasOwn`, not `in`: "toString" in CATEGORIA_LABEL is true.
  return typeof value === "string" && Object.hasOwn(CATEGORIA_LABEL, value);
}
