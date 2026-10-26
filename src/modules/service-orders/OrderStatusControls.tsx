"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";
import { ESPERA_MOTIVO_LABEL, ORDER_STATUS_LABEL } from "./statuses";
import { getManualTransitions, type OrderStatus } from "./transitions";

type Motivo = keyof typeof ESPERA_MOTIVO_LABEL;

/** One button. `on_hold` appears once per reason: two buttons need no dialog and meet the 44px rule (D7). */
type Action = { key: string; label: string; to: OrderStatus; esperaMotivo?: Motivo };

function actionsFor(from: OrderStatus): Action[] {
  return getManualTransitions(from).flatMap((to): Action[] => {
    if (to === "on_hold") {
      return (Object.keys(ESPERA_MOTIVO_LABEL) as Motivo[]).map((esperaMotivo) => ({
        key: `${to}:${esperaMotivo}`,
        label: `Marcar como ${ORDER_STATUS_LABEL[to]} (${ESPERA_MOTIVO_LABEL[esperaMotivo].toLowerCase()})`,
        to,
        esperaMotivo,
      }));
    }
    const label =
      from === "booked" && to === "open"
        ? "Recibir"
        : from === "on_hold" && to === "in_progress"
          ? "Reanudar"
          : `Marcar como ${ORDER_STATUS_LABEL[to]}`;
    return [{ key: to, label, to }];
  });
}

/** Success copy, subject first and in the past; no exclamation marks (AGENTS.md). */
function successMessage(from: OrderStatus, to: OrderStatus): string {
  if (to === "on_hold") return "Orden puesta en espera";
  if (from === "on_hold") return "Orden reanudada";
  if (from === "booked" && to === "open") return "Orden recibida";
  if (to === "done") return "Orden completada";
  if (to === "cancelled") return "Orden cancelada";
  return `Orden pasada a ${ORDER_STATUS_LABEL[to]}`;
}

/**
 * R21 — status-transition controls for the order-detail page. Renders one
 * button per legal manual next state (`transitions.ts`'s `getManualTransitions`
 * — no transition table duplicated here; `on_hold` once per reason), PATCHes
 * `/api/service-orders/[id]` with `{ status, esperaMotivo? }` (which also
 * carries R23's reminder scheduling/cancellation), then refreshes the
 * server-rendered page. Terminal states (`done`/`cancelled`) render nothing.
 * A failure stays inline, next to the buttons; only a success toasts.
 */
export function OrderStatusControls({
  orderId,
  status,
  canAssign,
}: {
  orderId: string;
  status: OrderStatus;
  /** `can(user, "service-orders.assign")`: without it nothing is offered; the route stays the gate. */
  canAssign: boolean;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = canAssign ? actionsFor(status) : [];

  async function run({ to, esperaMotivo }: Action) {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, ...(esperaMotivo ? { esperaMotivo } : {}) }),
      });

      if (!response.ok) {
        // A refusal carries its own Spanish text ("falta el vehículo", the
        // reason rules); anything else gets the generic line.
        const body = response.status === 400 || response.status === 403 ? await response.json().catch(() => null) : null;
        setError(body?.errors?.form ?? body?.errors?.esperaMotivo ?? body?.message ?? "No se pudo actualizar el estado de la orden.");
        return;
      }
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, so without this the buttons re-enable with nothing on screen
      // and the click looks like it simply did nothing.
      //
      // `router.refresh()` sits BELOW, not inside — a refresh that throws must
      // not be reported as a connection failure over a transition the server
      // already accepted.
      setError(CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }

    // ABOVE the refresh, BELOW the try/catch: a refresh that throws must not
    // retract the only confirmation of a transition the server accepted.
    addToast("success", successMessage(status, to));
    router.refresh();
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* AGENTS.md's 44x44 floor. These were `size="sm"` — `h-7`, 28px — so they
          sat 16px shorter than `Editar orden` and `Imprimir` beside them, and
          the header read as three different button sizes. A detail page on a
          workshop tablet is not the filter strip the standing exception covers. */}
      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="outline"
          size="default"
          className="min-h-11 min-w-11"
          disabled={isSubmitting}
          onClick={() => run(action)}
        >
          {isSubmitting ? "Actualizando…" : action.label}
        </Button>
      ))}
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
