"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/ui/ToastProvider";
import { getAllowedTransitions, type OrderStatus } from "./transitions";

const STATUS_LABEL: Record<OrderStatus, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};

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

      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
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
          {isSubmitting ? "Actualizando…" : `Marcar como ${STATUS_LABEL[next]}`}
        </Button>
      ))}
    </div>
  );
}
