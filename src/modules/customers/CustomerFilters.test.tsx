/**
 * R20/D6 — the "Ver desactivados" toggle is URL state, not client state. A
 * filter that does not survive a refresh or a shared link is one staff will
 * not trust, so what these assert is the URL the component pushes.
 *
 * The URL/debounce race suite (the three "reverted attempt" describes) moved
 * to `src/shared/ui/filters/useUrlFilters.test.tsx` — the race lives in the
 * hook now, not in this component (list-search-filters design D1–D3). What
 * stays here is coverage that only the REAL component can give: status
 * select wiring, search-term composition, and that the rendered input is
 * actually the one `clearAll` empties.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The mock navigates, and navigates LATE — because the real one does.
 *
 * `router.push` in Next 16 only dispatches into the React action queue;
 * `window.history.pushState` runs from a `useEffect` keyed on `appRouterState`
 * (`app-router.js:64,70`), so on a server-component page the URL lands only
 * after the RSC payload arrives.
 */
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
    usePathname: () => "/customers",
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

import { CustomerFilters } from "./CustomerFilters";

/** Seeds BOTH, because the component subscribes through the hook and reads the
 *  live URL when it writes. A test that set only one would be testing a state
 *  the browser never produces. */
function seedUrl(query: string) {
  searchParams.value = new URLSearchParams(query);
  window.history.replaceState({}, "", query ? `/customers?${query}` : "/customers");
}

afterEach(() => {
  pending.delay = 20;
  pending.delays = [];
  for (const timer of pending.timers) clearTimeout(timer);
  pending.timers = [];
  push.mockClear();
  searchParams.value = new URLSearchParams();
  window.history.replaceState({}, "", "/customers");
});

/**
 * The toggle went from a two-state checkbox to a three-state select. What
 * these tests protect — that the filter lives in the URL, survives the search
 * debounce, and is not clobbered by an external navigation — did not change.
 */
async function chooseStatus(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("combobox", { name: "Estado" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("CustomerFilters — customer status (R20)", () => {
  it("shows Activos by default, so the list is active-only until asked otherwise", () => {
    render(<CustomerFilters selected={{}} pageSize={10} />);
    expect(screen.getByRole("combobox", { name: "Estado" })).toHaveTextContent("Activos");
  });

  // The state the checkbox could not express, and the reason for the change.
  it("can ask for ONLY the deactivated ones, which the old toggle could not", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await chooseStatus(user, "Desactivados");

    expect(push).toHaveBeenCalledWith("/customers?status=inactive");
  });

  it("puts status=all in the URL when asked for everything", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await chooseStatus(user, "Todos");

    expect(push).toHaveBeenCalledWith("/customers?status=all");
  });

  it("removes it from the URL when back to Activos, rather than spelling out the default", async () => {
    const user = userEvent.setup();
    seedUrl("status=all");
    render(<CustomerFilters selected={{ status: "all" }} pageSize={10} />);

    await chooseStatus(user, "Activos");

    // `/customers`, not `/customers?` — `commit` omits the separator for an
    // empty query rather than pushing a bare "?".
    expect(push).toHaveBeenCalledWith("/customers");
  });

  it("keeps an active search term when the toggle changes", async () => {
    const user = userEvent.setup();
    seedUrl("search=perez");
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await chooseStatus(user, "Todos");

    const [url] = push.mock.calls[0] as [string];
    expect(url).toContain("search=perez");
    expect(url).toContain("status=all");
  });

  // `applyFilter` always drops `page` (design D5). Without that, ticking the
  // box while on page 3 would land on page 3 of a DIFFERENT result set —
  // usually empty, which reads as "there are none".
  it("returns to page 1 when the toggle changes", async () => {
    const user = userEvent.setup();
    seedUrl("page=3");
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await chooseStatus(user, "Todos");

    expect((push.mock.calls[0] as [string])[0]).not.toContain("page=3");
  });

  it("offers Limpiar once the toggle alone is on, not only after a search", () => {
    render(<CustomerFilters selected={{ status: "all" }} pageSize={10} />);
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
  });

  // The input is controlled now (list-search-filters), so this is evidence
  // the wiring is real: `clearAll` updates the state `value` is bound to, not
  // a DOM node reached through a ref that no longer exists.
  it("empties the search box, so the screen matches the list it produced", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    const input = screen.getByLabelText(/Filtro/) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(input.value).toBe("");
  });
});

/**
 * The round-2 fix landed on `/inventory` only, and GGA's round 3 found it
 * still standing here — one caller patched, the shared cause left alone. It is
 * derived inside `useUrlFilters` now (`hasTypedText`) so no third call site can
 * forget it.
 *
 * `selected` is the SERVER's view and lags a keystroke by the debounce plus an
 * RSC round trip. `clearAll` is the only thing that cancels a pending timer, so
 * hiding the button during that window means the term the operator tried to
 * cancel gets pushed anyway.
 */
describe("CustomerFilters — Limpiar is reachable while a debounce is pending", () => {
  it("offers Limpiar as soon as the box has text, before the server has seen it", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />); // nothing filtered yet

    await user.type(screen.getByLabelText("Filtro"), "perez");

    expect(screen.getByRole("button", { name: /Limpiar/ })).toBeInTheDocument();
  });

  it("cancels the pending push when it is clicked", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.type(screen.getByLabelText("Filtro"), "perez");
    await user.click(screen.getByRole("button", { name: /Limpiar/ }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400)); // past the debounce
    });

    for (const call of push.mock.calls) expect(String(call[0])).not.toContain("perez");
  });
});

/**
 * D5 — `applyFilter` drops `page` on EVERY filter change, `pageSize` included.
 * That is a behaviour change on this screen (the old code exempted
 * `pageSize`), and it had no assertion here until GGA round 3 said so: the
 * only coverage was on `/inventory`, the one screen whose behaviour did not
 * change.
 *
 * Staying on page 7 while the page size changes shows a slice of a list that
 * no longer exists.
 */
describe("CustomerFilters — page is dropped on every filter change (D5)", () => {
  it("drops page when pageSize changes", async () => {
    const user = userEvent.setup();
    seedUrl("page=7&search=perez");
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await user.click(screen.getByRole("combobox", { name: "Filas por página" }));
    await user.click(await screen.findByRole("option", { name: "50" }));

    const url = String(push.mock.calls.at(-1)?.[0]);
    expect(url).toContain("pageSize=50");
    expect(url).not.toContain("page=7");
  });
});
