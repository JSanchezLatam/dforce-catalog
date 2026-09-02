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
