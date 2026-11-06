/**
 * service-orders/hints.ts — the copy that explains a withheld order action.
 *
 * DB-free and string-only so the detail page (server), the work card and the
 * kanban board (client) share one source and cannot drift. `action` names the
 * button a surface should render beside the text; the surface owns the widget.
 */
import type { OrderAssignee } from "./order-team";
import { ORDER_STATUS_LABEL } from "./statuses";
import { isAllowedTransition, type OrderStatus } from "./transitions";

export type HintAction = "assign" | "technicians" | "edit";
export type Hint = { text: string; action?: HintAction };

/** Keys are the automatic targets (`AUTOMATIC_TARGETS`); pinned in hints.test.ts. */
const AUTO_TEXT: Partial<Record<OrderStatus, string>> = {
  diagnosing: "Pasa sola al asignar un técnico",
  ready_for_review: "Pasa sola cuando todos marcan su parte lista",
};

/** Why a drop on `to` is refused. "Pasa sola" only when the edge exists AND is automatic. */
export function blockedMoveReason(from: OrderStatus, to: OrderStatus): string {
  const auto = AUTO_TEXT[to];
  if (auto && isAllowedTransition(from, to)) return auto;
  return `Desde ${ORDER_STATUS_LABEL[from]} no se puede pasar a ${ORDER_STATUS_LABEL[to]}`;
}

/** "Asignar técnico" when a select renders, "Ir a Técnicos" only for who may manage them, else none. */
function assignAction(assignableCount: number, canManageTechnicians: boolean): HintAction | undefined {
  if (assignableCount > 0) return "assign";
  return canManageTechnicians ? "technicians" : undefined;
}

/** Hint under the status buttons. Administrador/jefe_taller only: everyone else gets null. */
export function statusBarHint(i: {
  status: OrderStatus;
  missing: ("vehiculo" | "categoria")[];
  assignees: OrderAssignee[];
  assignableCount: number;
  canAssign: boolean;
  canManageTechnicians: boolean;
}): Hint | null {
  if (!i.canAssign) return null;
  if (i.status === "open" && i.assignees.length === 0) {
    return {
      text: "Para pasarla a En diagnóstico, asigná un técnico.",
      action: assignAction(i.assignableCount, i.canManageTechnicians),
    };
  }
  if (i.status === "in_progress") {
    // readiness.ts counts ACTIVE assignees only, so the list does too.
    const pending = i.assignees.filter((a) => a.active && !a.parteLista).map((a) => a.nombre);
    if (pending.length === 0) return null;
    return { text: `Pasa a Lista para revisión cuando todos los técnicos marcan «Mi parte lista». Faltan: ${pending.join(", ")}.` };
  }
  if (i.status === "booked" && i.missing.length > 0) {
    return { text: "Completá el vehículo y la categoría antes de recibir la orden.", action: "edit" };
  }
  return null;
}

/** Hint on the "Líneas de trabajo" card, chosen by status and by whether the viewer is a jefe. */
export function workLinesHint(i: {
  status: OrderStatus;
  own: OrderAssignee | undefined;
  assigneeCount: number;
  assignableCount: number;
  canManageAll: boolean;
  canManageTechnicians: boolean;
}): Hint | null {
  const { status, own, canManageAll } = i;
  if (status === "open") {
    if (!canManageAll || i.assigneeCount > 0) return null;
    return {
      text: "Asigná un técnico para poder cargar líneas.",
      action: assignAction(i.assignableCount, i.canManageTechnicians),
    };
  }
  if (status === "booked") {
    if (canManageAll) return { text: "Recibí la orden para cargar líneas." };
    return own ? { text: "El jefe de taller tiene que recibir la orden para cargar líneas." } : null;
  }
  if (status === "on_hold") {
    if (canManageAll) return { text: "La orden está en espera; reanudala para cargar líneas." };
    return own ? { text: "La orden está en espera; el jefe de taller tiene que reanudarla." } : null;
  }
  if (canManageAll || !own) return null;
  if (status === "diagnosing" && !own.parteLista) {
    return { text: "Vas a poder marcar tu parte cuando el jefe de taller pase la orden a En progreso." };
  }
  if ((status === "in_progress" || status === "ready_for_review") && own.parteLista) {
    return { text: "Desmarcá tu parte lista antes de cambiar líneas de trabajo." };
  }
  return null;
}
