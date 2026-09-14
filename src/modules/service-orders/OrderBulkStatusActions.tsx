"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { runSequential, type RowOutcome } from "@/shared/bulk/run-sequential";
import { useSelection } from "@/shared/ui/selection/SelectionProvider";
import { useToast } from "@/shared/ui/ToastProvider";
import { ORDER_STATUS_LABEL } from "./statuses";
import {
  allowedTransitionsForAll,
  getAllowedTransitions,
  type OrderStatus,
} from "./transitions";

/**
 * The action slot `SelectionBar` leaves open, filled for `/service-orders`
 * (`service-orders` delta, design D1/D4/D9).
 *
 * **A caller, not a capability.** `PATCH /api/service-orders/[id]` already
 * routes `{status}` through `transitionOrder` → `assertTransition`, already
 * carries R23's reminder scheduling, and already answers
 * `{error:"invalid_transition", from, to}` with a 400. Bulk adds no route, no
 * `ROUTE_GUARDS` entry and no permission surface.
 *
 * **`runSequential`, never `Promise.all`.** Every per-row precondition in this
 * app is re-read inside that row's own transaction, and that is only enough
 * while the transactions do not overlap — proven on real Postgres in WU5, where
 * 40 concurrent runs zeroed the admin floor 40 times and 40 sequential runs
 * never did. It is also what makes per-row partial success reportable at all,
 * which is the entire content of the drift scenario below.
 */
async function setStatus(id: string, status: OrderStatus): Promise<RowOutcome> {
  const res = await fetch(`/api/service-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (res.ok) return { id, ok: true };

  const body = await res.json().catch(() => ({}));
  return { id, ok: false, reason: typeof body.error === "string" ? body.error : "request_failed" };
}

/**
 * `statuses` is the CURRENT PAGE's rows only — a `Record<string, string>`, the
 * one shape D3 lets a Server Component hand across the boundary. It is typed
 * with `| undefined` on purpose: the selection outlives the page it was made on
 * (WU4), so a selected id genuinely may not be in here, and a
 * `Record<string, OrderStatus>` would be a claim about rows this page never
 * read.
 */
export function OrderBulkStatusActions({
  statuses,
}: {
  statuses: Record<string, OrderStatus | undefined>;
}) {
  const { selected, setResult, clear } = useSelection();
  const router = useRouter();
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<OrderStatus | null>(null);

  const ids = [...selected];
  const known = ids.map((id) => statuses[id]);
  const onPage = known.filter((status) => status !== undefined);
  const offPage = known.length - onPage.length;

  /**
   * D9 — the menu offers the INTERSECTION of every selected row's legal next
   * states, computed in the browser with no round trip. Never the union: a menu
   * built from that offers `done` over a selection holding one `open` row, and
   * each of those rows comes back an `invalid_transition` the operator had no
   * way to predict from the menu they were shown.
   *
   * With any row off this page the intersection is unknowable, not empty — so
   * the action stands down and says which fact is missing. Reporting "nothing
   * is legal" there would be a second unchecked claim, and computing over the
   * visible rows alone would be a claim about the rows nobody read.
   */
  const targets = offPage > 0 ? [] : allowedTransitionsForAll(onPage);

  /**
   * Terminal is DERIVED from the state machine, not a hardcoded
   * `done`/`cancelled` pair — a fifth status with no outgoing edges would
   * otherwise ship without its warning, and this is the fourth place in the app
   * that would have had to know the list.
   */
  const isTerminal = target !== null && getAllowedTransitions(target).length === 0;

  async function apply(next: OrderStatus) {
    setPending(true);
    setResult(null);

    const outcomes = await runSequential(ids, (id) => setStatus(id, next));

    setResult(outcomes);
    // Consumed by the run. The panel keeps its labels through `clear()`, so the
    // rows that failed are still named after it.
    clear();
    setPending(false);
    setTarget(null);

    // The SUCCESSES, not `ids.length`: the drift case is a real outcome of this
    // run, and "3 órdenes actualizadas" beside a panel naming one that failed
    // is this component contradicting itself on screen. Zero stays silent —
    // the panel is already saying what happened, and a success toast over it
    // would announce a change that never landed.
    //
    // ABOVE `router.refresh()`, the ordering `OrderStatusControls` records: a
    // refresh that throws must not take the confirmation with it, and the bar
    // the operator was looking at has just been cleared.
    const applied = outcomes.filter((outcome) => outcome.ok).length;
    if (applied > 0) {
      addToast("success", `${applied} ${applied === 1 ? "orden actualizada" : "órdenes actualizadas"}`);
    }

    router.refresh();
  }

  return (
    <>
      {targets.length === 0 ? (
        // A plain disabled button rather than a disabled menu trigger: an
        // enabled trigger opening an empty popup reads as a broken menu, which
        // is the one outcome worse than no menu.
        <>
          <Button variant="outline" size="sm" className="min-h-11 min-w-11" disabled>
            Cambiar estado
          </Button>
          <p className="text-sm text-muted-foreground">
            {offPage > 0
              ? `No se puede calcular la acción común: ${offPage} ${offPage === 1 ? "orden seleccionada está" : "órdenes seleccionadas están"} fuera de esta página`
              : "No hay ninguna acción común a esta selección"}
          </p>
        </>
      ) : (
        <DropdownMenu>
          {/* `buttonVariants` on the base-ui trigger, not a `<Button>` wrapping
              it — the same composition `RowActions` records. `min-h-11
              min-w-11` is AGENTS.md's 44x44 floor on top of `size="sm"`'s
              `h-7`, matching "Limpiar selección" beside it. */}
          <DropdownMenuTrigger
            disabled={pending}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 min-w-11")}
          >
            Cambiar estado
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-40">
            {targets.map((next) => (
              /* A plain item with `onClick`, NOT `render={<button/>}`. Measured
                 twice in this repo against base-ui 1.6: rendering a real button
                 replaces base-ui's own item handler, the one Enter reaches, and
                 keyboard activation drops to 0. `render` is the fix for a
                 NAVIGATION item, which has to stay an anchor; these are
                 actions. */
              <DropdownMenuItem key={next} onClick={() => setTarget(next)}>
                Marcar como {ORDER_STATUS_LABEL[next]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Mounted OUTSIDE the menu, deliberately. Measured in jsdom for
          `UsersTable`'s edit dialog: inside a `DropdownMenuItem`, selecting the
          item closes the menu and unmounts the dialog with it — 0 dialogs
          opened, mouse or keyboard. The item only sets state here. */}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogTitle>Confirmar cambio de estado</DialogTitle>
          <DialogBody className="space-y-2 text-sm text-muted-foreground">
            <p>
              Se van a marcar {ids.length} {ids.length === 1 ? "orden" : "órdenes"} como{" "}
              <strong className="text-foreground">
                {target !== null && ORDER_STATUS_LABEL[target]}
              </strong>
              .
            </p>
            {isTerminal && (
              <p>
                Este cambio es terminal: no se puede deshacer desde la aplicación.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>
              Cancelar
            </DialogClose>
            <Button
              disabled={pending}
              onClick={() => {
                if (target !== null) void apply(target);
              }}
            >
              {pending ? "Aplicando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
