/**
 * service-orders/statuses.ts — the labels staff read for `orden_servicio.status`,
 * in one place, typed against the enum.
 *
 * Same shape and same reason as `categories.ts` (C4, design.md D3): the map is a
 * `Record<OrderStatus, string>`, so adding a FIFTH status — the enum has four — is a `tsc` error rather
 * than a `label={undefined}` that ships silently. It was previously hand-rolled
 * as `Record<string, string>` in `customers/[id]/page.tsx`, and WU3 was about to
 * make that a third copy (GGA round 1 on PR #60).
 */
import type { OrderStatus } from "./transitions";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};
