"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";
import { ORDER_STATUS_LABEL } from "./statuses";
import { getAllowedTransitions, type OrderStatus } from "./transitions";

/**
 * R21 — status-transition controls for the order-detail page. Renders one
 * button per legal next state (`transitions.ts`'s `getAllowedTransitions`,
 * Phase 6 addition — no transition table duplicated here), PATCHes
 * `/api/service-orders/[id]` with `{ status }` (Phase 5's route, which also
 * carries R23's reminder scheduling/cancellation), then refreshes the
 * server-rendered page. Terminal states (`done`/`cancelled`) render nothing.
 */
export function OrderStatusControls({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextStates = getAllowedTransitions(status);

  async function transitionTo(next: OrderStatus) {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });

      if (!response.ok) {
        addToast("error", "No se pudo actualizar el estado de la orden.");
        return;
      }
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, so without this the buttons re-enable with no toast at all
      // and the click looks like it simply did nothing. Worse here than on the
      // other five surfaces that share this copy (four forms and `UsersTable`):
      // nothing was typed, so there is no dialog left open to hint that
      // anything happened.
      //
      // `router.refresh()` sits BELOW, not inside — a refresh that throws must
      // not be reported as a connection failure over a transition the server
      // already accepted.
      addToast("error", CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }

    router.refresh();
  }

  if (nextStates.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {nextStates.map((next) => (
        <Button
          key={next}
          type="button"
          variant="outline"
          size="sm"
          disabled={isSubmitting}
          onClick={() => transitionTo(next)}
        >
          {isSubmitting ? "Actualizando…" : `Marcar como ${ORDER_STATUS_LABEL[next]}`}
        </Button>
      ))}
    </div>
  );
}
