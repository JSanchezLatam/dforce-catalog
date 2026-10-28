/**
 * kanban/overrides.ts - optimistic state, derived during render (lint forbids setState in an effect).
 *
 * An override holds a card in its optimistic place. `seq === null` means the request is still pending;
 * a number is the hook's good-poll counter when the server confirmed. A poll that was already in flight
 * when the PATCH landed is snapshot #1 and may still show the old status, so an override outlives ONE
 * snapshot after confirmation and is dropped at the second. Counting snapshots, not comparing
 * `generatedAt`: LAN clocks disagree. Bound: a card another user moves inside that window shows the
 * override for at most two more polls.
 */
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";

export type Override = { status?: OrderStatus; urgent?: boolean; seq: number | null };

const SNAPSHOTS_TO_SETTLE = 2;

type Overridable = { id: string; status: OrderStatus; statusLabel: string; urgent: boolean };

export function applyOverrides<T extends Overridable>(rows: T[], overrides: ReadonlyMap<string, Override>, seq: number): T[] {
  if (overrides.size === 0) return rows;
  return rows.map((row) => {
    const o = overrides.get(row.id);
    if (!o || (o.seq !== null && seq - o.seq >= SNAPSHOTS_TO_SETTLE)) return row;
    const status = o.status ?? row.status;
    const urgent = o.urgent ?? row.urgent;
    // Already matches: keep the row itself, so an unchanged card keeps its identity.
    if (status === row.status && urgent === row.urgent) return row;
    return { ...row, status, statusLabel: ORDER_STATUS_LABEL[status], urgent };
  });
}
