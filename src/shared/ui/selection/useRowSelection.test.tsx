/**
 * design.md D4/D5 — the selection model written once for all four tables.
 *
 * `.test.tsx`, not `.test.ts`, and that is a deliberate departure from task
 * 4.4's "(node)": a React hook needs `renderHook`, which mounts into a real
 * container. The extension is what routes a file to the jsdom project
 * (`vitest.config.ts`), so a `.test.ts` here would run without a DOM and fail
 * for a reason that has nothing to do with selection.
 *
 * The two properties that carry the safety weight:
 *
 * - a `pageIds` change is PAGING and must not touch the selection;
 * - a `filterKey` change is a FILTER and must clear it, loudly, with the count.
 *
 * The page decides which is which by what it puts in `filterKey` — that half
 * is pinned in `customers/page.test.tsx`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRowSelection, type Reconcile, type RowSelection } from "./useRowSelection";

/**
 * Spelled out rather than inferred from `initialProps`: inference pins
 * `labels` to page 1's three exact keys, so `rerender` with page 3's labels is
 * a type error — and the whole point of these tests is that the two pages
 * carry different rows.
 */
type Props = Parameters<typeof useRowSelection>[0];

/** Let any pending `Reconcile` resolve, so "nothing happened" is observable. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const PAGE_1 = ["c1", "c2", "c3"];
const PAGE_3 = ["c7", "c8"];
const LABELS_1 = { c1: "Ana Gómez", c2: "Beto Ruiz", c3: "Caro Díaz" };
const LABELS_3 = { c7: "Gustavo Paz", c8: "Hilda Vera" };

describe("useRowSelection", () => {
  it("keeps rows selected on page 1 after paging to page 3", async () => {
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "search=|status=active" },
    });

    act(() => {
      result.current.toggle("c1");
      result.current.toggle("c2");
    });
    expect([...result.current.selected]).toEqual(["c1", "c2"]);

    // Paging: new ids, new labels, SAME filterKey.
    rerender({ pageIds: PAGE_3, labels: LABELS_3, filterKey: "search=|status=active" });

    // The flush is load-bearing, and this test was a placebo without it.
    // `Reconcile` is async, so a clearing triggered by this rerender is still
    // one microtask away — a synchronous assertion here passes even while the
    // selection is on its way out. Measured: leaking `pageIds` into the
    // filter key left this green until the await was added.
    await settle();

    expect([...result.current.selected]).toEqual(["c1", "c2"]);
    expect(result.current.clearedByFilter).toBeNull();

    act(() => result.current.toggle("c7"));
    expect(result.current.selected.size).toBe(3);
  });

  it("names a selected row that is no longer on screen", async () => {
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "k" },
    });

    act(() => result.current.toggle("c2"));
    rerender({ pageIds: PAGE_3, labels: LABELS_3, filterKey: "k" });
    await settle();

    // The label was captured at tick time, so the bar can still say who "c2"
    // is on a page that no longer renders the row.
    expect(result.current.labelOf("c2")).toBe("Beto Ruiz");
    expect(result.current.labelOf("c9")).toBeUndefined();
  });

  it("selects every row on the page, then deselects only those rows", async () => {
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "k" },
    });

    act(() => result.current.togglePage());
    expect([...result.current.selected]).toEqual(PAGE_1);

    // A row picked on another page must survive the header checkbox being
    // switched off here — it clears THIS page, not the selection.
    rerender({ pageIds: PAGE_3, labels: LABELS_3, filterKey: "k" });
    await settle();
    act(() => result.current.toggle("c7"));
    rerender({ pageIds: PAGE_1, labels: LABELS_1, filterKey: "k" });
    await settle();

    act(() => result.current.togglePage());
    expect([...result.current.selected]).toEqual(["c7"]);
  });

  it("clears the whole selection when filterKey changes, and reports how many went", async () => {
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "search=|status=active" },
    });

    act(() => result.current.togglePage());
    expect(result.current.selected.size).toBe(3);

    rerender({ pageIds: PAGE_1, labels: LABELS_1, filterKey: "search=perez|status=active" });

    await waitFor(() => expect(result.current.clearedByFilter).toBe(3));
    expect(result.current.selected.size).toBe(0);
  });

  it("routes the filter change through the injected Reconcile, not a hardcoded clear", async () => {
    // D5's seam: swapping `dropAll` for a server-resolved survivor list is one
    // function, and this is what proves the call site exists to swap.
    const reconcile = vi.fn<Reconcile>(async () => ["c3"]);
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "a", reconcile },
    });

    act(() => result.current.togglePage());
    rerender({ pageIds: PAGE_1, labels: LABELS_1, filterKey: "b", reconcile });

    await waitFor(() => expect([...result.current.selected]).toEqual(["c3"]));
    expect(reconcile).toHaveBeenCalledOnce();
    expect([...reconcile.mock.calls[0][0]]).toEqual(PAGE_1);
    expect(reconcile.mock.calls[0][1]).toBe("b");
    expect(result.current.clearedByFilter).toBe(2);
  });

  it("says nothing when the filter changes with nothing selected", async () => {
    const reconcile = vi.fn<Reconcile>(async () => []);
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "a", reconcile },
    });

    rerender({ pageIds: PAGE_1, labels: LABELS_1, filterKey: "b", reconcile });

    await waitFor(() => expect(reconcile).not.toHaveBeenCalled());
    // "Se limpió la selección de 0" is noise on a screen nobody was selecting on.
    expect(result.current.clearedByFilter).toBeNull();
  });

  it("drops the cleared-by-filter notice as soon as a new selection starts", async () => {
    const { result, rerender } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "a" },
    });

    act(() => result.current.toggle("c1"));
    rerender({ pageIds: PAGE_1, labels: LABELS_1, filterKey: "b" });
    await waitFor(() => expect(result.current.clearedByFilter).toBe(1));

    act(() => result.current.toggle("c2"));
    expect(result.current.clearedByFilter).toBeNull();
  });

  it("clears on demand", () => {
    const { result } = renderHook<RowSelection, Props>((props) => useRowSelection(props), {
      initialProps: { pageIds: PAGE_1, labels: LABELS_1, filterKey: "a" },
    });

    act(() => result.current.togglePage());
    act(() => result.current.clear());

    expect(result.current.selected.size).toBe(0);
    // Manual clearing is not a filter change, and must not borrow its message.
    expect(result.current.clearedByFilter).toBeNull();
  });
});
