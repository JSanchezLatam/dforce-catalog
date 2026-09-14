"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { runSequential, type RowOutcome } from "@/shared/bulk/run-sequential";
import { useSelection } from "@/shared/ui/selection/SelectionProvider";
import { useToast } from "@/shared/ui/ToastProvider";

/**
 * The action slot `SelectionBar` leaves open, filled for `/customers`
 * (`customer-management` delta, design D1).
 *
 * **A caller, not a capability.** `PATCH /api/customers/[id]` already routes
 * `{active}` to `deactivateCliente`/`reactivateCliente`, already rejects
 * `active` combined with a field edit, and already answers `not_found` for a
 * row another session removed. A bulk endpoint would add a route, a
 * `ROUTE_GUARDS` entry and a permission surface to reach behaviour that
 * already exists — and a server-side loop is exactly the thing a later reader
 * rewrites as `UPDATE … WHERE id IN (…)`.
 *
 * `runSequential` rather than `Promise.all`: unlike `/users` there is no
 * cross-row precondition here to race, but the runner is the one way a bulk
 * action executes in this app (D2), and the N sequential PATCHes are also what
 * make partial success per row reportable at all.
 */
async function setActive(id: string, active: boolean): Promise<RowOutcome> {
  const res = await fetch(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (res.ok) return { id, ok: true };

  const body = await res.json().catch(() => ({}));
  return { id, ok: false, reason: typeof body.error === "string" ? body.error : "request_failed" };
}

export function CustomerBulkActions() {
  const { selected, setResult, clear } = useSelection();
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  async function apply(active: boolean) {
    setPending(true);
    setResult(null);

    const outcomes = await runSequential([...selected], (id) => setActive(id, active));

    setResult(outcomes);
    // Consumed by the run — see `UserBulkActions`. The panel keeps its labels
    // through `clear()`, so the failed rows are still named after it.
    clear();
    setPending(false);

    // Off the OUTCOMES, never off the selection: a partial run must not claim
    // the rows the server refused. Zero stays silent — the result panel
    // already names every failure, and "0 clientes desactivados" beside it
    // would be an emptier copy of the same news.
    //
    // The `s` covers both words at once: "1 clientes desactivados" is wrong in
    // Spanish and is exactly the shape a `${n} clientes` template ships.
    const applied = outcomes.filter((o) => o.ok).length;
    if (applied > 0) {
      const s = applied === 1 ? "" : "s";
      addToast("success", `${applied} cliente${s} ${active ? "reactivado" : "desactivado"}${s}`);
    }
    router.refresh();
  }

  return (
    <>
      {/* `size="sm"` is `h-7`; `min-h-11 min-w-11` is AGENTS.md's 44x44 floor
          on top of it, matching "Limpiar selección" beside them. */}
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 min-w-11"
        disabled={pending}
        onClick={() => apply(true)}
      >
        Activar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 min-w-11"
        disabled={pending}
        onClick={() => apply(false)}
      >
        Desactivar
      </Button>
    </>
  );
}
