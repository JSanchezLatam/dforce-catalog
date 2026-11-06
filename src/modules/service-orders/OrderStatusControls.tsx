"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Inbox, Pause, Wrench, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ORDER_HUE } from "@/shared/ui/status-hue";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";
import { ESPERA_MOTIVO_LABEL, ORDER_STATUS_LABEL } from "./statuses";
import { getManualTransitions, type OrderStatus } from "./transitions";

type Motivo = keyof typeof ESPERA_MOTIVO_LABEL;

/**
 * One button. `on_hold` appears once per reason: two buttons need no dialog and meet the 44px rule (D7).
 * `label` is the visible text AND the accessible name (WCAG 2.5.3): no `aria-label`.
 */
type Action = { key: string; label: string; to: OrderStatus; icon: LucideIcon; fill: boolean; esperaMotivo?: Motivo };

const TARGET_ICON: Partial<Record<OrderStatus, LucideIcon>> = {
  open: Inbox,
  in_progress: Wrench,
  on_hold: Pause,
  done: Check,
  cancelled: Ban,
};

/** The normal next step of each status is the one filled button; `open` and `in_progress` have none. */
const FILLED_TARGET: Partial<Record<OrderStatus, OrderStatus>> = {
  booked: "open",
  diagnosing: "in_progress",
  on_hold: "in_progress",
  ready_for_review: "done",
};

function shortLabel(from: OrderStatus, to: OrderStatus): string {
  if (to === "open") return "Recibir";
  if (to === "done") return "Completar";
  if (to === "cancelled") return "Cancelar";
  // to === "in_progress"
  return from === "on_hold" ? "Reanudar" : from === "diagnosing" ? "Pasar a En progreso" : "Volver a En progreso";
}

/** Filled button first, the rest in `getManualTransitions` order; Cancelar is split off by the caller. */
function actionsFor(from: OrderStatus): Action[] {
  const actions = getManualTransitions(from).flatMap((to): Action[] => {
    const icon = TARGET_ICON[to]!;
    const fill = FILLED_TARGET[from] === to;
    if (to === "on_hold") {
      return (Object.keys(ESPERA_MOTIVO_LABEL) as Motivo[]).map((esperaMotivo) => ({
        key: `${to}:${esperaMotivo}`,
        label: `En espera · ${esperaMotivo === "aprobacion_cliente" ? "aprobación" : ESPERA_MOTIVO_LABEL[esperaMotivo].toLowerCase()}`,
        to,
        icon,
        fill,
        esperaMotivo,
      }));
    }
    return [{ key: to, label: shortLabel(from, to), to, icon, fill }];
  });
  return [...actions.filter((a) => a.fill), ...actions.filter((a) => !a.fill)];
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
  const cancel = actions.find((a) => a.to === "cancelled");
  const others = actions.filter((a) => a !== cancel);

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

  // The 44x44 floor stays explicit: `hue` carries no `pointer-coarse:` rise of its own to rely on.
  const button = (action: Action) => {
    const Icon = action.icon;
    const hue = action.to === "cancelled" ? null : ORDER_HUE[action.to as keyof typeof ORDER_HUE];
    return (
      <Button
        key={action.key}
        type="button"
        variant={hue ? "hue" : "destructive"}
        size="default"
        className={cn("min-h-11 min-w-11 @max-[639px]:w-full", hue && (action.fill ? "hue-fill" : "hue-tint"))}
        style={hue ? ({ "--h": String(hue.h), "--s": hue.s } as CSSProperties) : undefined}
        disabled={isSubmitting}
        onClick={() => run(action)}
      >
        <Icon aria-hidden="true" />
        {isSubmitting ? "Actualizando…" : action.label}
      </Button>
    );
  };

  return (
    <div className="@container w-full">
      {/* Below 640px of container the row becomes one full-width column and the divider a hairline. */}
      <div className="flex flex-wrap items-center gap-2 @max-[639px]:grid @max-[639px]:grid-cols-1">
        {others.map(button)}
        {cancel && (
          <>
            {others.length > 0 && (
              <span aria-hidden="true" className="mx-1 h-6 w-px self-center bg-border @max-[639px]:mx-0 @max-[639px]:h-px @max-[639px]:w-auto" />
            )}
            {button(cancel)}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
