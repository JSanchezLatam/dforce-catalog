/**
 * R20/D6 — the "Ver desactivados" toggle is URL state, not client state. A
 * filter that does not survive a refresh or a shared link is one staff will
 * not trust, so what these assert is the URL the component pushes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The mock navigates, and navigates LATE — because the real one does.
 *
 * `router.push` in Next 16 only dispatches into the React action queue;
 * `window.history.pushState` runs from a `useEffect` keyed on `appRouterState`
 * (`app-router.js:64,70`), so on a server-component page the URL lands only
 * after the RSC payload arrives.
 *
 * The previous version of this mock called `replaceState` synchronously, which
 * is MORE synchronous than the real router — it manufactured the very property
 * the race test claims to check, so no test in this file could fail on it. The
 * delay here is what makes that test able to fail.
 */
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
/**
 * Subscribers to the mocked `useSearchParams`. Next re-renders every consumer
 * when a navigation COMMITS; without this the mocked hook returns one frozen
 * object forever, the component's `useEffect([searchParams])` never fires, and
 * an entire class of bug — anything about what happens when a navigation lands
 * — is inexpressible. That is exactly how the two-pushes-outstanding defect
 * survived a test written to catch it.
 */
const listeners = vi.hoisted(() => new Set<() => void>());
const pending = vi.hoisted(() => ({
  timers: [] as ReturnType<typeof setTimeout>[],
  delay: 20,
  /** Per-push delays, consumed in order, so two pushes can be outstanding with
   *  the FIRST landing before the second. */
  delays: [] as number[],
}));

/** Commits a navigation the way Next does: URL first, then every consumer of the hook. */
const land = vi.hoisted(() => (url: string) => {
  const next = url.split("?")[1] ?? "";
  // A navigation to the SAME url produces no new `searchParams`, so consumers
  // are not re-rendered. Notifying unconditionally — as this mock did — hides
  // every bug about a push that does not change the URL, which is the fourth
  // mock-fidelity gap of this shape on this branch.
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

  // `applyFilter` drops `page` for every key except `pageSize`. Without that,
  // ticking the box while on page 3 would land on page 3 of a DIFFERENT result
  // set - usually empty, which reads as "there are none".
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
});

/**
 * The third instance of the failure class WU8.1 and WU10.5 already chased: a
 * filter surviving one layer and not the next. Here it is a RACE, not a
 * missing line — `applyDebounced` schedules `applyFilter`'s closure 300ms out,
 * so an immediate push landing inside that window was overwritten by the
 * stale snapshot.
 *
 * Real timers on purpose: the debounce is a real `setTimeout` and the bug is
 * about WHEN the params are read, which fake timers plus `userEvent`'s own
 * timer advancement made too easy to get wrong in either direction.
 */
describe("CustomerFilters — the debounce must not clobber a newer filter", () => {
  it("keeps the status when the search debounce fires after it", async () => {
    // Navigation SLOWER than the 300ms debounce. This is the case that
    // separates a correct fix from one that merely narrows the window: with a
    // fast mock, the URL lands before the timeout and even a
    // `window.location`-only read passes. On a server-component page the push
    // waits for the RSC payload over a list query that is a sequential scan,
    // so "slower than 300ms" is the realistic shape, not the exotic one.
    pending.delay = 450;
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.type(screen.getByLabelText(/Filtro/), "perez");
    // Inside the 300ms window — this is the interaction that lost the flag.
    await chooseStatus(user, "Todos");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=perez");
    expect(last).toContain("status=all");
  });
});

/**
 * "Limpiar" bypassed `applyFilter` entirely with its own `router.push`, so it
 * updated neither the ref nor the pending debounce — while the comment above
 * `applyFilter` claimed it was "the ONLY writer". The fifth occurrence of one
 * failure class in this change, and the first where the invariant was asserted
 * in prose rather than enforced.
 */
describe("CustomerFilters — Limpiar goes through the same writer", () => {
  it("does not resurrect a cleared filter on the next keystroke", async () => {
    const user = userEvent.setup();
    pending.delay = 450; // navigation slower than the debounce, as in production
    // `selected` is what the SERVER already rendered, so seeding it on is how
    // the screen looks when Limpiar is reachable at all.
    seedUrl("status=all");
    render(<CustomerFilters selected={{ status: "all" }} pageSize={10} />);

    await chooseStatus(user, "Todos");
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    // Before the clear's navigation lands — the ordinary "clear, then search
    // again" rhythm.
    await user.type(screen.getByLabelText(/Filtro/), "ana");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=ana");
    expect(last).not.toContain("status");
  });

  it("cancels a pending search instead of letting it re-push the cleared term", async () => {
    const user = userEvent.setup();
    pending.delay = 450;
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await user.type(screen.getByLabelText(/Filtro/), "z");
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(push.mock.calls.at(-1)?.[0]).toBe("/customers");
  });

  it("empties the search box, so the screen matches the list it produced", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    const input = screen.getByLabelText(/Filtro/) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(input.value).toBe("");
  });
});

/**
 * Two pushes outstanding at once, which the single-push race test above cannot
 * express. `useSearchParams()` reflects the COMMITTED url, so the first
 * navigation landing used to null the ref that was holding the SECOND one —
 * and the next debounce then rebuilt from `window.location`, which still
 * showed the first. The checkbox came back unticked.
 */
describe("CustomerFilters — two pushes outstanding", () => {
  it("keeps every filter when an earlier navigation lands while a later one is still pending", async () => {
    const user = userEvent.setup();
    // First push lands quickly; the second stays in flight for the whole test.
    pending.delays = [100, 5000];
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.type(screen.getByLabelText(/Filtro/), "perez");
    await new Promise((resolve) => setTimeout(resolve, 320)); // debounce fires → push A
    await chooseStatus(user, "Todos"); // → push B
    await new Promise((resolve) => setTimeout(resolve, 200)); // A lands, B still pending

    await user.type(screen.getByLabelText(/Filtro/), "x");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=perezx");
    expect(last).toContain("status=all");
  });
});
