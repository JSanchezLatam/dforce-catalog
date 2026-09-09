/**
 * Did not exist before this change (checked directly — only
 * `CustomerFilters.test.tsx` had coverage of this shape). `/inventory` is the
 * screen the reported defect was MEASURED on: typed `ABC` into `#filter-id`,
 * `bateria` into `#filter-name` 120ms later, waited 1200ms, and the URL
 * became `?name=bateria` — the ID term silently gone, while the box still
 * showed `ABC`. One shared `debounceRef` plus a stale-closure `applyFilter`
 * (`searchParams.toString()`) both contribute; `useUrlFilters` (D2/D4) fixes
 * both as a side effect of the shared rewire.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const listeners = vi.hoisted(() => new Set<() => void>());
const pending = vi.hoisted(() => ({
  timers: [] as ReturnType<typeof setTimeout>[],
  delay: 20,
  delays: [] as number[],
}));

const land = vi.hoisted(() => (url: string) => {
  const next = url.split("?")[1] ?? "";
  const unchanged = next === searchParams.value.toString();
  window.history.replaceState({}, "", url);
  if (unchanged) return;
  searchParams.value = new URLSearchParams(next);
  for (const notify of listeners) notify();
});

const push = vi.hoisted(() =>
  vi.fn((url: string) => {
    const delay = pending.delays.length > 0 ? pending.delays.shift()! : pending.delay;
    pending.timers.push(setTimeout(() => land(url), delay));
  }),
);
vi.mock("next/navigation", async () => {
  const { useReducer, useEffect } = await import("react");
  return {
    useRouter: () => ({ push }),
    usePathname: () => "/inventory",
    useSearchParams: () => {
      const [, force] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        listeners.add(force);
        return () => {
          listeners.delete(force);
        };
      }, []);
      return searchParams.value;
    },
  };
});

import { InventoryFilters } from "./InventoryFilters";

function seedUrl(query: string) {
  searchParams.value = new URLSearchParams(query);
  window.history.replaceState({}, "", query ? `/inventory?${query}` : "/inventory");
}

afterEach(() => {
  pending.delay = 20;
  pending.delays = [];
  for (const timer of pending.timers) clearTimeout(timer);
  pending.timers = [];
  push.mockClear();
  searchParams.value = new URLSearchParams();
  window.history.replaceState({}, "", "/inventory");
});

function renderFilters(selected: { id?: string; name?: string } = {}) {
  return render(
    <InventoryFilters
      categoryL1Options={[]}
      categoryL2Options={[]}
      selected={selected}
      pageSize={10}
    />,
  );
}

describe("InventoryFilters — both text inputs are controlled", () => {
  /**
   * Behavioural, deliberately. The first draft of this test asserted
   * `not.toHaveAttribute("defaultValue")`, which is vacuous: React never
   * renders an attribute by that name — it maps `defaultValue` to the `value`
   * attribute — so the assertion passes for an uncontrolled input too, and the
   * test named "bound via value not defaultValue" proved neither half.
   *
   * Typing is what tells them apart. An uncontrolled, URL-driven input shows
   * the keystroke only because the DOM holds it; a controlled one shows it
   * because state does. So the assertion that carries weight is the one BELOW
   * — the box reflects the keystroke before any push has landed, and the URL
   * has not moved.
   */
  it("#filter-id shows the URL value on mount", () => {
    seedUrl("id=ABC");
    renderFilters({ id: "ABC" });
    expect((screen.getByLabelText("ID") as HTMLInputElement).value).toBe("ABC");
  });

  it("#filter-id reflects a keystroke from state, before any push lands", async () => {
    const user = userEvent.setup();
    seedUrl("id=ABC");
    renderFilters({ id: "ABC" });

    await user.type(screen.getByLabelText("ID"), "X");

    expect(screen.getByLabelText("ID")).toHaveValue("ABCX");
    expect(push).not.toHaveBeenCalled(); // still inside the debounce window
  });

  /**
   * `clearAll` is the ONLY thing here that cancels a pending debounce timer,
   * so it has to stay reachable while one is pending. Deriving `disabled` from
   * `selected` alone — the SERVER's view, which lags a keystroke by the whole
   * debounce — disabled the button in exactly that window: type, click
   * Limpiar, the click does nothing because the button is disabled, and the
   * timer then filters by the term the operator just tried to cancel.
   *
   * `selected` is deliberately EMPTY here. A fixture that pre-seeds it renders
   * the button enabled for the wrong reason and never reaches this path.
   */
  it("keeps Limpiar reachable while a debounce is pending, so it can cancel it", async () => {
    const user = userEvent.setup();
    renderFilters({});

    await user.type(screen.getByLabelText("Nombre"), "bater");
    await user.click(screen.getByRole("button", { name: /Limpiar/ }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400)); // past the debounce
    });

    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    // The cancelled term must never have reached the URL.
    for (const call of push.mock.calls) expect(String(call[0])).not.toContain("bater");
  });

  /**
   * The re-seed effect also runs on MOUNT with the counter at zero, so without
   * a guard it reads the first render as an external navigation and overwrites
   * the caller's `selected` with raw `searchParams`.
   *
   * `?id=A&id=B` is the shape that exposes it: the page's
   * `typeof params.id === "string"` guard leaves `selected.id` undefined so the
   * LIST is unfiltered, while `searchParams.get("id")` answers `"A"` — a box
   * showing a filter that is not applied.
   */
  it("does not overwrite the caller's value with a duplicated URL param on mount", () => {
    seedUrl("id=A&id=B");
    renderFilters({}); // the page dropped the duplicate, so nothing is filtered

    expect(screen.getByLabelText("ID")).toHaveValue("");
  });

  it("#filter-name shows the URL value on mount", () => {
    seedUrl("name=bateria");
    renderFilters({ name: "bateria" });
    const input = screen.getByLabelText("Nombre") as HTMLInputElement;
    expect(input.value).toBe("bateria");
  });
});

/**
 * The measured defect, reproduced by its exact shape — not a generic
 * "debounce works" test. One shared `debounceRef` clears the FIRST field's
 * timer when the second field is typed into inside the debounce window, so
 * `id` is dropped, not merely delayed.
 */
describe("InventoryFilters — two text fields must not clobber each other (D4)", () => {
  it("keeps BOTH id and name after typing into id, then name, inside the debounce window", async () => {
    const user = userEvent.setup();
    renderFilters();

    await user.type(screen.getByLabelText("ID"), "ABC");
    await new Promise((resolve) => setTimeout(resolve, 120));
    await user.type(screen.getByLabelText("Nombre"), "bateria");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("id=ABC");
    expect(last).toContain("name=bateria");
  });
});

/**
 * D5 — `page` is dropped on EVERY filter change, `pageSize` included. This is
 * `/inventory`'s existing behaviour (its old `setPageSize` already deleted
 * `page` unconditionally): the rewire must not change it.
 *
 * None of `Categoría 1`/`Categoría 2`/`Stock`/`Filas por página`'s `<Label>`s
 * carry `htmlFor` (pre-existing gap, unrelated to this change) — the
 * comboboxes are addressed by render order: Categoría 1, Categoría 2, Stock,
 * pageSize.
 */
describe("InventoryFilters — Categoría/Stock selects and pageSize (D5)", () => {
  it("Categoría 1 pushes immediately, with no debounce to wait out", async () => {
    const user = userEvent.setup();
    render(
      <InventoryFilters
        categoryL1Options={["Frenos"]}
        categoryL2Options={[]}
        selected={{}}
        pageSize={10}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Frenos" }));

    expect(push).toHaveBeenCalledWith("/inventory?categoryL1=Frenos");
  });

  it("a category change drops page", async () => {
    const user = userEvent.setup();
    seedUrl("page=3");
    render(
      <InventoryFilters
        categoryL1Options={["Frenos"]}
        categoryL2Options={[]}
        selected={{}}
        pageSize={10}
      />,
    );

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Frenos" }));

    expect((push.mock.calls[0] as [string])[0]).not.toContain("page=3");
  });

  it("a pageSize change also drops page, same as every other filter", async () => {
    const user = userEvent.setup();
    seedUrl("page=3");
    renderFilters();

    await user.click(screen.getAllByRole("combobox").at(-1)!);
    await user.click(await screen.findByRole("option", { name: "25" }));

    const [url] = push.mock.calls[0] as [string];
    expect(url).toContain("pageSize=25");
    expect(url).not.toContain("page=3");
  });
});

describe("InventoryFilters — Limpiar goes through the shared writer", () => {
  it("empties both text boxes", async () => {
    const user = userEvent.setup();
    renderFilters({ id: "ABC", name: "bateria" });

    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect((screen.getByLabelText("ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
  });
});
