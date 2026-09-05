"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${clienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !isActive }),
      });
      if (!response.ok) {
        setError(
          isActive ? "No se pudo desactivar el cliente." : "No se pudo reactivar el cliente.",
        );
        return;
      }
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={isActive ? "outline" : "default"}
        size="sm"
        className="min-h-11"
        disabled={isSubmitting}
        onClick={toggle}
      >
        {isActive ? "Desactivar" : "Reactivar"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
