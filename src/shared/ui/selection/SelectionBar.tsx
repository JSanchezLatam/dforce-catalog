"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useSelection } from "./SelectionProvider";

/**
 * The one selection bar for all four tables (design.md D4).
 *
 * Two obligations it exists to meet, both from the spec rather than from
 * taste:
 *
 * 1. **The off-screen portion is legible, not merely counted.** "12
 *    seleccionados" with 3 rows on screen has to say that 9 are off-screen and
 *    offer a way to see or clear them — a bare total is explicitly not
 *    acceptable ("Off-screen selection is legible, not just counted").
 * 2. **A filter change is announced, never silent.** Clearing is
 *    unconditional (D5), which is exactly why the message says only that the
 *    selection was cleared and how big it was. An earlier draft said the rows
 *    "no coinciden con el filtro nuevo" — a lie, since most cleared rows
 *    usually DO match, and the spec carries a scenario pinning that negative.
 *
 * `children` is the action slot units 5, 6 and 7a fill with their own buttons.
 * This component knows nothing about what a bulk action does.
 */
export function SelectionBar({ children }: { children?: ReactNode }) {
  const { selected, pageIds, labelOf, clear, clearedByFilter } = useSelection();

  const total = selected.size;
  const onPage = pageIds.filter((id) => selected.has(id)).length;
  const offScreen = total - onPage;

  // Nothing selected and nothing to announce: the bar does not exist. It is
  // not an empty strip taking vertical space above every list in the app.
  if (total === 0 && clearedByFilter === null) return null;

  return (
    <div
      className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3"
      // `status`, not `alert`: this reports on something the operator just
      // did, and does not interrupt.
      role="status"
    >
      {clearedByFilter !== null && (
        <p className="text-sm text-foreground">
          Se limpió la selección de {clearedByFilter} al cambiar el filtro
        </p>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm font-medium text-foreground">
            {total} {total === 1 ? "seleccionado" : "seleccionados"}
            {offScreen > 0 && (
              <span className="ml-2 font-normal text-muted-foreground">
                ({offScreen} fuera de esta página)
              </span>
            )}
          </p>

          {/* Native `<details>` rather than a state-driven popover: the whole
              requirement is "a way to view the full set", and the platform
              already has a disclosure. The labels come from the hook's
              tick-time map, so a row selected on page 1 is still named on
              page 3 where nothing renders it. */}
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-primary hover:underline">
              Ver seleccionados
            </summary>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {[...selected].map((id) => (
                // The id is the fallback, not a blank: a selection made before
                // this page loaded its labels still has to name its rows
                // somehow, and a bare id beats an empty bullet.
                <li key={id}>{labelOf(id) ?? id}</li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            {children}
            <Button variant="outline" size="sm" className="min-h-11 min-w-11" onClick={clear}>
              Limpiar selección
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
