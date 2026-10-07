"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CONNECTION_ERROR } from "@/shared/ui/messages";
import { FIELD_ERROR } from "@/shared/ui/styles";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * Assigns ONE technician to the order (`POST .../assignments`); staff only, the
 * page decides. `available` is the ACTIVE roster minus whoever is already on the
 * order, as plain data. There is no un-assign, so there is nothing to undo here.
 */
export function AssignTecnicoControl({ orderId, available }: { orderId: string; available: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [tecnicoId, setTecnicoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">Todos los técnicos activos ya están asignados.</p>;
  }

  async function assign() {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/service-orders/${orderId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.errors?.tecnicoId ?? body?.message ?? "No se pudo asignar el técnico.");
        return;
      }
    } catch {
      setError(CONNECTION_ERROR);
      return;
    } finally {
      setIsSubmitting(false);
    }

    setTecnicoId("");
    // ABOVE the refresh, both BELOW the try/catch: see `OrderStatusControls`.
    addToast("success", "Técnico asignado");
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="assign-tecnico">Asignar técnico</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="assign-tecnico"
          className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-xs"
          value={tecnicoId}
          disabled={isSubmitting}
          onChange={(event) => setTecnicoId(event.target.value)}
        >
          <option value="">Elegí un técnico</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <Button type="button" className="min-h-11 min-w-11" disabled={isSubmitting || tecnicoId === ""} onClick={assign}>
          {isSubmitting ? "Asignando…" : "Asignar"}
        </Button>
      </div>
      {error && (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
