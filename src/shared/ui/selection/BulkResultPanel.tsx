"use client";

import { Button } from "@/components/ui/button";
import { useSelection } from "./SelectionProvider";

/**
 * Per-row partial-success reporting, shared shell (design.md D4).
 *
 * The spec's requirement is that every row that did not apply is named — "2 no
 * se pudieron" is explicitly not acceptable — so this renders a labelled line
 * per failure and a count for the successes.
 *
 * **It does not own a refusal vocabulary.** `reasons` maps that capability's
 * machine codes (`last_active_admin`, `invalid_transition`, …) to Spanish and
 * is injected by the caller. A shared map here would collect every
 * capability's codes in one file and make each page carry the other three's
 * copy. An unmapped code falls back to the raw code rather than to a generic
 * sentence: a reader can search the codebase for `last_active_admin`, and
 * "no se pudo" tells them nothing.
 *
 * `reasons` is a `Record<string, string>`, so a Server Component may pass it —
 * the D3 rule holds here as everywhere else in this directory.
 */
export function BulkResultPanel({
  reasons = {},
}: {
  reasons?: Readonly<Record<string, string>>;
}) {
  const { result, setResult, labelOf } = useSelection();

  if (result === null || result.length === 0) return null;

  const applied = result.filter((outcome) => outcome.ok).length;
  const failed = result.filter((outcome) => !outcome.ok);

  return (
    <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3" role="status">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {applied === 1 ? "Se aplicó 1 fila" : `Se aplicaron ${applied} filas`}
          {failed.length > 0 &&
            (failed.length === 1 ? " y 1 no se pudo." : ` y ${failed.length} no se pudieron.`)}
          {failed.length === 0 && "."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 min-w-11"
          onClick={() => setResult(null)}
        >
          Cerrar
        </Button>
      </div>

      {failed.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
          {failed.map((outcome) => (
            <li key={outcome.id}>
              <span className="font-medium text-foreground">{labelOf(outcome.id) ?? outcome.id}</span>
              {": "}
              {outcome.reason ? (reasons[outcome.reason] ?? outcome.reason) : "Motivo desconocido"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
