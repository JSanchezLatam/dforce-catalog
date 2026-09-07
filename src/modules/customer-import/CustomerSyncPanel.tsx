"use client";

import { useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
 *
 * The card around the button is `inventory-view/InventoryStatsHeader`'s, so
 * the two synced-from-Interfuerza screens read the same way. The total sits
 * beside the trigger because the trigger is what changes it — the customer
 * list had no total anywhere, and the one screen that syncs them is where the
 * question "how many are synced" gets asked.
 *
 * `total` is a prop, not a fetch: this is a `"use client"` component and the
 * count is already in hand at the Server Component call site.
 */
export function CustomerSyncPanel({ total, canSync }: { total: number; canSync: boolean }) {
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
        addToast("error", body.error ?? "No se pudo sincronizar a los clientes.");
        return;
      }
      const body: ImportResponse = await res.json();
      addToast(
        "success",
        `Sincronización completa: ${body.created} nuevos, ${body.updated} actualizados, ${body.skipped.length} omitidos.`,
      );
      setSkipped(body.skipped);
    } catch {
      // `fetch` REJECTS on a network failure rather than returning a non-ok
      // response, and `res.json()` can throw on a malformed body too —
      // without this the button re-enabled with nothing on screen and the
      // operator clicked again into the same silence (same defect already
      // fixed once in `CustomerActivationButton`).
      addToast("error", "No se pudo sincronizar a los clientes.");
    } finally {
      setRunning(false);
    }
  }

  return (
    // The skip report is a SIBLING of the card, not a child of it: inside the
    // header row it stretched that row and pushed the actions out of place,
    // which is what put it here. Full width below, it can list every row
    // without moving anything above it.
    <div className="mb-4 flex flex-col gap-2">
      <Card size="sm">
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total de clientes</p>
              <p className="text-3xl font-bold text-foreground">{total}</p>
              <p className="text-sm text-muted-foreground">sincronizados desde Interfuerza</p>
            </div>
            {/* Only the ACTION is privileged. The total beside it is data on a
                page the reader can already open. */}
            {canSync && (
              <Button type="button" variant="outline" size="default" className="min-h-11 min-w-11" onClick={handleClick} disabled={running}>
                <RefreshCw aria-hidden="true" />
                {running ? "Sincronizando…" : "Sincronizar clientes"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {skipped.length > 0 && (
        // D5 — the skip report exists so "the owner can add the real
        // number"; a bare count names nobody. Each row states its own reason
        // (Finding 1) instead of a single heading that was only true for
        // `missing_phone`.
        //
        // `role="alert"`, and in the destructive variant: these rows did NOT
        // import. Rendered as plain muted text outside any live region, the
        // only thing a screen reader heard was the success toast
        // ("Sincronización completa …") — it never learned the run was
        // partial, which is the half of the result that needs acting on.
        <Alert role="alert" variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p>Clientes omitidos:</p>
            <ul className="list-disc pl-5">
              {skipped.map((s, i) => (
                // `i` is always in the key: two skipped rows can share the same
                // `externalId` (planImport dedupes insert/update rows but
                // passes skips through untouched), which collided here.
                <li key={`${s.externalId ?? s.name}-${i}`}>{skipLabel(s)}</li>
              ))}
            </ul>
          </div>
        </Alert>
      )}
    </div>
  );
}
