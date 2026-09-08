"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useSelection } from "./SelectionProvider";

/**
 * The checkbox column. No new table primitive is added:
 * `[&:has([role=checkbox])]:pr-0` on `TableHead`/`TableCell` and
 * `components/ui/checkbox.tsx` already exist.
 *
 * `table.tsx` also ships `data-[state=selected]:bg-muted` on `TableRow`, but
 * NOTHING SETS THAT ATTRIBUTE — the row is rendered by a Server Component and
 * only this client leaf knows the selection, so a selected row is currently
 * distinguished by the 16px tick alone. Wiring the row highlight needs a
 * client `SelectableRow` wrapper; it is a follow-up, and it matters most in
 * unit 5, where the selection feeds a destructive action. Recorded here
 * rather than left as a comment implying an affordance that never fires.
 *
 * The visible box stays shadcn's 16px, but the TAP TARGET is 44x44 per
 * AGENTS.md — this is a workshop tablet and ticking a row is what feeds a
 * bulk deactivate. Same treatment `RowActions` gives the kebab trigger.
 *
 * `label` is the row's display name and is only used for the accessible name:
 * a list page renders one of these per row, and `getByRole("checkbox", …)`
 * has to be able to tell them apart — the same reason `RowActions` requires a
 * per-row `label`.
 */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <span className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center p-2">
      <Checkbox
        checked={selected.has(id)}
        onCheckedChange={() => toggle(id)}
        aria-label={`Seleccionar ${label}`}
      />
    </span>
  );
}

/**
 * The header checkbox: select-all-**on-page**, never select-all-matching.
 * There is no server-side "seleccionar los N que coinciden con el filtro" in
 * this change (proposal's known limitation, `tasks.md` follow-up), and the
 * accessible name says which of the two this is so nobody reads it as the
 * other.
 *
 * Tri-state: checked when every row on the page is selected, indeterminate
 * when only some are. Rows selected on OTHER pages are deliberately not part
 * of that calculation — unticking here clears this page, not the selection.
 */
export function SelectAllCheckbox() {
  const { selected, pageIds, togglePage } = useSelection();
  const onPage = pageIds.filter((id) => selected.has(id)).length;
  const all = pageIds.length > 0 && onPage === pageIds.length;

  return (
    <span className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center p-2">
      <Checkbox
        checked={all}
        indeterminate={onPage > 0 && !all}
        onCheckedChange={() => togglePage()}
        aria-label="Seleccionar todo lo de esta página"
      />
    </span>
  );
}
