"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/ui/ToastProvider";

type ImportResponse = {
  created: number;
  updated: number;
  skipped: { externalId: string | null; name: string | null; reason: string }[];
};

/**
 * R21/D6 — admin manual trigger for the Interfuerza customer import.
 * Mirrors `inventory-sync/ManualSyncButton.tsx`'s shape (button + toast on
 * completion), simplified because `runCustomerImport` runs synchronously
 * inside the route handler (no pg-boss queue like inventory-sync) — the
 * result comes back in the same response, so there is nothing to poll.
 */
export function CustomerImportButton() {
  const [running, setRunning] = useState(false);
  const { addToast } = useToast();

  async function handleClick() {
    setRunning(true);
    try {
      const res = await fetch("/api/customer-import", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addToast("error", body.error ?? "No se pudo importar a los clientes.");
        return;
      }
      const body: ImportResponse = await res.json();
      addToast(
        "success",
        `Importación completa: ${body.created} nuevos, ${body.updated} actualizados, ${body.skipped.length} omitidos.`,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={running}>
      {running ? "Importando…" : "Importar clientes"}
    </Button>
  );
}
