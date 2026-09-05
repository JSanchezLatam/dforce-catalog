"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/ui/ToastProvider";
// Type-only import — erased at build, pulls no DB code into the client
// bundle. Restating this union by hand (as `reason: string`) is what let the
// heading below claim a false reason for two of the three `SkipReason`s.
import type { ImportSkip } from "./job";
import type { SkipReason } from "./mapper";

type ImportResponse = {
  created: number;
  updated: number;
  skipped: ImportSkip[];
};

// Finding 1 — `mapCustomerRow` (mapper.ts) emits three reasons, and the
// operator needs to know which one applies to each row, not a single
// heading that is only true for `missing_phone`.
const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  missing_phone: "sin teléfono",
  missing_name: "sin nombre",
  missing_external_id: "sin identificador externo",
};

function skipLabel(s: ImportSkip): string {
  const who = s.name ?? s.externalId ?? "registro sin datos";
  return `${who} — ${SKIP_REASON_LABEL[s.reason]}`;
}

/**
 * R21/D6 — admin manual trigger for the Interfuerza customer import.
 * Mirrors `inventory-sync/ManualSyncButton.tsx`'s shape (button + toast on
 * completion), simplified because `runCustomerImport` runs synchronously
 * inside the route handler (no pg-boss queue like inventory-sync) — the
 * result comes back in the same response, so there is nothing to poll.
 */
export function CustomerImportButton() {
  const [running, setRunning] = useState(false);
  const [skipped, setSkipped] = useState<ImportSkip[]>([]);
  const { addToast } = useToast();

  async function handleClick() {
    setRunning(true);
    setSkipped([]);
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
      setSkipped(body.skipped);
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, and `res.json()` can throw on a malformed body too —
      // without this the button re-enabled with nothing on screen and the
      // operator clicked again into the same silence (same defect already
      // fixed once in `CustomerActivationButton`).
      addToast("error", "No se pudo importar a los clientes.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" onClick={handleClick} disabled={running}>
        {running ? "Importando…" : "Importar clientes"}
      </Button>
      {skipped.length > 0 && (
        // D5 — the skip report exists so "the owner can add the real
        // number"; a bare count names nobody. Each row states its own reason
        // (Finding 1) instead of a single heading that was only true for
        // `missing_phone`.
        <div className="text-sm text-muted-foreground">
          <p>Clientes omitidos:</p>
          <ul className="list-disc pl-5">
            {skipped.map((s, i) => (
              <li key={s.externalId ?? `${s.name}-${i}`}>{skipLabel(s)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
