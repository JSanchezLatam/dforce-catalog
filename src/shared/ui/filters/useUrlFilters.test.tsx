/**
 * D3 — the URL/debounce race machinery, moved here verbatim from
 * `CustomerFilters.tsx` (two earlier attempts, one of them shipped — see the
 * hook's own comments). Tested against a tiny harness that calls
 * `useUrlFilters` directly, not through any screen component, because the
 * race lives in the hook now, not in any one filter bar.
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
 *
 * A synchronous mock would manufacture the very property under test, so no
 * test in this file could fail on it — the delay here is what makes that
 * test able to fail.
 */
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
/**
 * Subscribers to the mocked `useSearchParams`. Next re-renders every consumer
 * when a navigation COMMITS; without this the mocked hook returns one frozen
 * object forever and the hook's `useEffect([searchParams])` never fires.
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
  // are not re-rendered. Notifying unconditionally hides every bug about a
  // push that does not change the URL.
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
    usePathname: () => "/list",
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

import { useUrlFilters } from "./useUrlFilters";

/**
 * A tiny harness, not a screen component — `useUrlFilters` is what is under
 * test, not `CustomerFilters`. "Todos" mirrors an immediate filter (a
 * `Select`'s `onValueChange`, no keystrokes to wait out); "Filtro" mirrors a
 * debounced text field.
 */
function Harness({ initial = {} }: { initial?: Record<string, string> }) {
  const { text, setText, applyFilter, clearAll } = useUrlFilters(initial);
  return (
    <div>
      <label htmlFor="search">Filtro</label>
      <input id="search" value={text.search ?? ""} onChange={(e) => setText("search", e.target.value)} />
      <button onClick={() => applyFilter("status", "all")}>Todos</button>
      <button onClick={clearAll}>Limpiar</button>
    </div>
  );
}

/** Seeds BOTH, because the hook subscribes through `useSearchParams` and reads
 *  the live URL when it writes. A test that set only one would be testing a
 *  state the browser never produces. */
function seedUrl(query: string) {
  searchParams.value = new URLSearchParams(query);
  window.history.replaceState({}, "", query ? `/list?${query}` : "/list");
}

afterEach(() => {
  pending.delay = 20;
  pending.delays = [];
  for (const timer of pending.timers) clearTimeout(timer);
  pending.timers = [];
  push.mockClear();
  searchParams.value = new URLSearchParams();
  window.history.replaceState({}, "", "/list");
});

/**
 * The third instance of the failure class WU8.1 and WU10.5 already chased: a
 * filter surviving one layer and not the next. Here it is a RACE, not a
 * missing line — `setText` schedules `applyFilter`'s closure `debounceMs` out,
 * so an immediate push landing inside that window was overwritten by the
 * stale snapshot.
 *
 * Real timers on purpose: the debounce is a real `setTimeout` and the bug is
 * about WHEN the params are read.
 */
describe("useUrlFilters — the debounce must not clobber a newer filter", () => {
  it("keeps the status when the search debounce fires after it", async () => {
    pending.delay = 450;
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText(/Filtro/), "perez");
    await user.click(screen.getByRole("button", { name: "Todos" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=perez");
    expect(last).toContain("status=all");
  });
});

/**
 * `clearAll` bypassed the single writer in the two earlier screens this hook
 * replaces, updating neither the ref nor the pending debounce.
 */
describe("useUrlFilters — Limpiar goes through the same writer", () => {
  it("does not resurrect a cleared filter on the next keystroke", async () => {
    const user = userEvent.setup();
    pending.delay = 450;
    seedUrl("status=all");
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Todos" }));
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await user.type(screen.getByLabelText(/Filtro/), "ana");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=ana");
    expect(last).not.toContain("status");
  });

  it("cancels a pending search instead of letting it re-push the cleared term", async () => {
    const user = userEvent.setup();
    pending.delay = 450;
    render(<Harness initial={{ search: "perez" }} />);

    await user.type(screen.getByLabelText(/Filtro/), "z");
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(push.mock.calls.at(-1)?.[0]).toBe("/list");
  });

  it("empties the search box, so the screen matches the list it produced", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ search: "perez" }} />);

    const input = screen.getByLabelText(/Filtro/) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(input.value).toBe("");
  });
});

/**
 * Two pushes outstanding at once, which the single-push race test above
 * cannot express. `useSearchParams()` reflects the COMMITTED url, so the
 * first navigation landing must not release the ref that is holding the
 * SECOND one.
 */
describe("useUrlFilters — two pushes outstanding", () => {
  it("keeps every filter when an earlier navigation lands while a later one is still pending", async () => {
    const user = userEvent.setup();
    pending.delays = [100, 5000];
    render(<Harness />);

    await user.type(screen.getByLabelText(/Filtro/), "perez");
    await new Promise((resolve) => setTimeout(resolve, 320)); // debounce fires → push A
    await user.click(screen.getByRole("button", { name: "Todos" })); // → push B
    await new Promise((resolve) => setTimeout(resolve, 200)); // A lands, B still pending

    await user.type(screen.getByLabelText(/Filtro/), "x");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=perezx");
    expect(last).toContain("status=all");
  });
});

/**
 * D3's `wasOurs` line has exactly two branches, neither expressible as a
 * hook-level test before this unit existed.
 */
describe("useUrlFilters — re-seed only on external navigation", () => {
  it("re-seeds text when the URL changes with no push of ours outstanding", async () => {
    seedUrl("search=perez");
    render(<Harness initial={{ search: "perez" }} />);
    expect(screen.getByLabelText(/Filtro/)).toHaveValue("perez");

    // An external navigation: no commit(), no counter incremented.
    await act(async () => {
      land("/list");
    });

    expect(screen.getByLabelText(/Filtro/)).toHaveValue("");
  });

  it("does not re-seed when its own push lands while typing continues", async () => {
    const user = userEvent.setup();
    pending.delay = 200;
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Todos" })); // commit() → pendingPushes = 1
    await user.type(screen.getByLabelText(/Filtro/), "ana"); // local state only, no push yet
    await new Promise((resolve) => setTimeout(resolve, 250)); // push lands: wasOurs === true

    expect(screen.getByLabelText(/Filtro/)).toHaveValue("ana");
  });
});
