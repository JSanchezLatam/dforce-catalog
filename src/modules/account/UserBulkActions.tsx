"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { runSequential, type RowOutcome } from "@/shared/bulk/run-sequential";
import { useSelection } from "@/shared/ui/selection/SelectionProvider";

/**
 * The bulk half of `/users` — the action slot `SelectionBar` leaves open
 * (design D1/D2, `user-management` delta).
 *
 * **TWO buttons, never one that infers the direction per row.** A selection
 * that mixes active and inactive users needs opposite operations, and a single
 * "Alternar" would have to guess which; the spec makes that a MUST, and it is
 * also what keeps a mixed selection unambiguous on screen.
 *
 * **`runSequential` is load-bearing here and must not become `Promise.all`.**
 * `deactivateUser()` is race-safe only because it re-queries the active-admin
 * set inside its own transaction — and under `read committed` (this app's
 * `default_transaction_isolation`) per-call transactions are NOT enough:
 * two overlapping calls both observe the same two active administrators, both
 * pass `checkAdminSafety`, and both commit. What closes that window is that
 * call N+1 is issued only after call N's response, so its fresh read observes
 * N's commit. `UsersTable.test.tsx`'s "deactivates exactly one of the last two
 * administrators" is mutation-verified against exactly the `Promise.all`
 * substitution.
 */
async function setActive(id: string, active: boolean): Promise<RowOutcome> {
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (res.ok) return { id, ok: true };

  // The route answers a refused mutation with the machine reason from
  // `checkAdminSafety` (`api/users/[id]/route.ts:72-76`); `REFUSAL_MESSAGES`
  // turns it into Spanish at the panel. An unparseable body still has to name
  // a code rather than an empty reason, or the panel prints "Motivo
  // desconocido" for a row whose response we simply failed to read.
  const body = await res.json().catch(() => ({}));
  return { id, ok: false, reason: typeof body.error === "string" ? body.error : "request_failed" };
}

export function UserBulkActions() {
  const { selected, setResult, clear } = useSelection();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function apply(active: boolean) {
    setPending(true);
    // The previous run's panel goes before this one starts: leaving it up
    // while new rows are being written invites reading it as this run's
    // result.
    setResult(null);

    const outcomes = await runSequential([...selected], (id) => setActive(id, active));

    setResult(outcomes);
    // The selection is consumed by the run. Leaving it armed on a destructive
    // action is how a second click applies it twice, and the panel — which
    // keeps its labels through `clear()` — is the record of what happened.
    clear();
    setPending(false);
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
