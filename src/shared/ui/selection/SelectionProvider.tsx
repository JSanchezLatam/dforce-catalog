"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { RowOutcome } from "@/shared/bulk/run-sequential";
import { useRowSelection, type RowSelection } from "./useRowSelection";

/**
 * The client boundary for a Server Component list page (design.md D3).
 *
 * **Its whole job is the boundary.** The rows keep being rendered on the
 * server — the empty states, the sort links and the 60 lines of Spanish copy
 * in `customers/page.tsx` never cross — and this component provides selection
 * context around them as RSC children, which are already-rendered elements
 * rather than a render prop.
 *
 * **Exactly three props cross, and every one is a primitive or a
 * `Record<string, string>`:**
 *
 * | Prop | Type |
 * |---|---|
 * | `pageIds` | `string[]` |
 * | `labels` | `Record<string, string>` |
 * | `filterKey` | `string` |
 *
 * No function, no `Date`, no class instance. Next.js REFUSES a function handed
 * from a Server Component to a client one and the page simply does not render,
 * and jsdom cannot see it happen (AGENTS.md's second documented limit —
 * `render()` invokes a page as a plain function, so there is no RSC
 * serialization to violate). That defect already shipped here once, through
 * `Pagination`, and stayed invisible for months.
 *
 * `Reconcile` (D5's seam) is deliberately NOT a prop for the same reason: a
 * server page could not pass one. The provider always uses the hook's default
 * `dropAll`; a future client wrapper that wants server-resolved survivors
 * consumes `useRowSelection` directly.
 */

type SelectionContextValue = RowSelection & {
  /** The ids rendered on the current page — the header tri-state and the bar's off-screen count read this. */
  pageIds: readonly string[];
  /** The last bulk run's per-row outcomes, or `null` when there is nothing to report. */
  result: readonly RowOutcome[] | null;
  setResult: (outcomes: readonly RowOutcome[] | null) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const value = useContext(SelectionContext);
  if (value === null) {
    throw new Error("useSelection() must be called inside a <SelectionProvider>");
  }
  return value;
}

export function SelectionProvider({
  pageIds,
  labels,
  filterKey,
  children,
}: {
  pageIds: string[];
  labels: Record<string, string>;
  filterKey: string;
  children: ReactNode;
}) {
  const selection = useRowSelection({ pageIds, labels, filterKey });
  const [result, setResult] = useState<readonly RowOutcome[] | null>(null);

  // No `useMemo`: `useRowSelection` returns a fresh object every render, so
  // memoising on it would be decorative. This component re-renders only when
  // the selection actually changes or the server hands it new props, and its
  // `children` are stable RSC elements React skips either way.
  const value: SelectionContextValue = { ...selection, pageIds, result, setResult };

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
