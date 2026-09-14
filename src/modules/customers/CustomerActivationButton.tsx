"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, RotateCcw, TriangleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * R20 — deactivate or reactivate one customer. Same wrapper shape as
 * `CustomerFormTrigger`: a Server Component cannot hand a function across the
 * RSC boundary, so this owns `useRouter()` and refreshes on success.
 *
 * No confirmation dialog, deliberately. This repo asks first only for what
 * cannot be undone — `CustomerForm` confirms "Eliminar definitivamente" and
 * says nothing before "Quitar". Deactivation is the reversible one, and its
 * inverse is the button that replaces it.
 */
export function CustomerActivationButton({ clienteId, isActive }: { clienteId: string; isActive: boolean }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setIsSubmitting(true);
    setError(null);
    const failure = isActive ? "No se pudo desactivar el cliente." : "No se pudo reactivar el cliente.";
    try {
      const response = await fetch(`/api/customers/${clienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !isActive }),
      });
      if (!response.ok) {
        setError(failure);
        return;
      }
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, so without this the button re-enabled with nothing on
      // screen and the operator clicked again into the same silence.
      setError(failure);
      return;
    } finally {
      setIsSubmitting(false);
    }

    // Both of these sit BELOW the try/catch, matching `OrderStatusControls`.
    // `router.refresh()` used to be inside the `try`, where a refresh that
    // threw was caught and printed "No se pudo desactivar el cliente." over a
    // deactivation the server had already accepted — and it would now retract
    // the confirmation beside it. The toast goes first for the same reason:
    // the mutation is committed, so nothing downstream may swallow the only
    // thing that says so on a page whose rows are server-rendered.
    addToast("success", isActive ? "Cliente desactivado" : "Cliente reactivado");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={isActive ? "outline" : "default"}
        size="default"
        className="min-h-11 min-w-11"
        disabled={isSubmitting}
        onClick={toggle}
      >
        {isActive ? <Power aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        {isActive ? "Desactivar" : "Reactivar"}
      </Button>
      {error && (
        // Block-level: the whole action failed, and there is no input to sit
        // under. `role="alert"` is unchanged — the box is styling, not new
        // semantics.
        <Alert role="alert" variant="destructive">
          <TriangleAlert aria-hidden="true" />
          {error}
        </Alert>
      )}
    </div>
  );
}
