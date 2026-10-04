"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * "Marcar como contactado": records the "Contactado" mark. It lives inside the
 * "Contactar" dialog (`ContactDialog`); its props are the item's identity and
 * nothing else.
 *
 * Same shape as `OrderStatusControls`: the toast goes above `router.refresh()`
 * and both sit below the `try/catch`, so a refresh that throws neither retracts
 * the confirmation of a mark the server accepted nor reads as a network error.
 */
export function ContactadoButton({
  vehiculoId,
  kind,
  periodKey,
}: {
  vehiculoId: string;
  kind: "placa" | "seguro";
  periodKey: string;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function mark() {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/vencimientos/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehiculoId, kind, periodKey }),
      });
      if (!response.ok) {
        addToast("error", "No se pudo marcar el vencimiento como contactado.");
        return;
      }
    } catch {
      addToast("error", CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }

    addToast("success", "Vencimiento marcado como contactado");
    router.refresh();
  }

  return (
    // 44x44: `size="default"` is h-8, and this is a tablet screen.
    <Button type="button" variant="outline" size="default" className="min-h-11 min-w-11" disabled={isSubmitting} onClick={mark}>
      {isSubmitting ? "Marcando…" : "Marcar como contactado"}
    </Button>
  );
}
