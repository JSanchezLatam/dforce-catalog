"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The one selection model for all four list tables (design.md D4).
 *
 * What is shared here is not a SHAPE, it is a SAFETY RULE: what happens to a
 * live selection when the filter changes, and how a selection the operator can
 * no longer see stays legible. `table-column-sorting` D3 chose duplication for
 * three sort parsers and that held, because those were three copies of a
 * signature. Four copies of this would be four chances to get the sharpest
 * edge in the change wrong.
 */

/**
 * D5's seam. `dropAll` is what ships; a server-resolved survivor list is one
 * function plus one route per capability, and that route re-opens D1/D2's
 * argument — so it is designed for and deliberately not built.
 */
export type Reconcile = (
  selected: ReadonlySet<string>,
  nextFilterKey: string,
) => Promise<string[]>;

/** Module-level, so the default never re-triggers the effect below. */
export const dropAll: Reconcile = async () => [];

export type RowSelection = {
  selected: ReadonlySet<string>;
  labelOf(id: string): string | undefined;
  toggle(id: string): void;
  togglePage(): void;
  clear(): void;
  /** Non-null only while a filter-change notice is worth showing. */
  clearedByFilter: number | null;
};

type State = { selected: ReadonlySet<string>; labels: ReadonlyMap<string, string> };

const EMPTY: State = { selected: new Set(), labels: new Map() };

export function useRowSelection({
  pageIds,
  labels,
  filterKey,
  reconcile = dropAll,
}: {
  pageIds: readonly string[];
  labels: Readonly<Record<string, string>>;
  filterKey: string;
  reconcile?: Reconcile;
}): RowSelection {
  const [state, setState] = useState<State>(EMPTY);
  const [clearedByFilter, setClearedByFilter] = useState<number | null>(null);

  /**
   * Labels are captured HERE, at tick time, not read from `labels` when the
   * bar renders (D5): by then the operator may be three pages away and the
   * prop holds a different ten rows. A name captured on page 1 can go stale if
   * the customer is renamed elsewhere — accepted, because a stale name beside
   * a live id beats a bare count.
   */
  const select = useCallback((ids: readonly string[], labelSource: Readonly<Record<string, string>>) => {
    setClearedByFilter(null);
    setState((prev) => {
      const selected = new Set(prev.selected);
      const nextLabels = new Map(prev.labels);
      const removing = ids.every((id) => selected.has(id));
      for (const id of ids) {
        if (removing) {
          selected.delete(id);
        } else {
          selected.add(id);
          const label = labelSource[id];
          if (label !== undefined) nextLabels.set(id, label);
        }
      }
      return { selected, labels: nextLabels };
    });
  }, []);

  const toggle = useCallback((id: string) => select([id], labels), [select, labels]);

  /**
   * The header checkbox. All-on-page selected → clear THIS page; otherwise add
   * every row on it. It never touches a row picked on another page, which is
   * the whole reason the selection survives paging in the first place.
   */
  const togglePage = useCallback(() => {
    if (pageIds.length > 0) select(pageIds, labels);
  }, [select, pageIds, labels]);

  const clear = useCallback(() => {
    setClearedByFilter(null);
    setState((prev) => ({ selected: new Set(), labels: prev.labels }));
  }, []);

  /**
   * D5 — a filter change clears the selection, loudly.
   *
   * Guarded on the PREVIOUS key rather than on mount, so the first render
   * never announces a clearing that did not happen, and a re-render with an
   * unchanged key (paging, sorting, a new `labels` object) is a no-op. Which
   * changes count as a filter is the calling page's decision, spelled out in
   * the `filterKey` it computes.
   */
  const previousKey = useRef(filterKey);
  useEffect(() => {
    if (previousKey.current === filterKey) return;
    previousKey.current = filterKey;

    // `state.selected` from THIS render, not a ref: a ref written during
    // render is a lint error and a real hazard under concurrent rendering.
    // Listing it as a dependency makes the effect re-run on every tick, which
    // the `previousKey` guard above turns into a no-op — so the cost is one
    // comparison and the value is always current.
    const before = state.selected;
    if (before.size === 0) return;

    let cancelled = false;
    void reconcile(before, filterKey).then((survivors) => {
      if (cancelled) return;
      setState((prev) => ({ selected: new Set(survivors), labels: prev.labels }));
      setClearedByFilter(before.size - survivors.length);
    });
    return () => {
      cancelled = true;
    };
  }, [filterKey, reconcile, state.selected]);

  const labelOf = useCallback((id: string) => state.labels.get(id), [state.labels]);

  return { selected: state.selected, labelOf, toggle, togglePage, clear, clearedByFilter };
}
