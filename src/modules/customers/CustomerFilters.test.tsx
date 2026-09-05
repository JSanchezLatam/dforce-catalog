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
 * Handles are tracked so `afterEach` can cancel them. A late navigation left
 * pending by one test lands during the NEXT one and rewrites its URL — which
 * is exactly what happened the first time this mock was made asynchronous.
 */
const pending = vi.hoisted(() => ({ timers: [] as ReturnType<typeof setTimeout>[], delay: 20 }));
const push = vi.hoisted(() =>
  vi.fn((url: string) => {
    pending.timers.push(setTimeout(() => window.history.replaceState({}, "", url), pending.delay));
  }),
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/customers",
  useSearchParams: () => searchParams.value,
}));

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
  for (const timer of pending.timers) clearTimeout(timer);
  pending.timers = [];
  push.mockClear();
  searchParams.value = new URLSearchParams();
  window.history.replaceState({}, "", "/customers");
});

describe("CustomerFilters — ver desactivados (R20)", () => {
  it("is off by default, so the list is active-only until asked otherwise", () => {
    render(<CustomerFilters selected={{}} pageSize={10} />);
    expect(screen.getByRole("checkbox", { name: "Ver desactivados" })).not.toBeChecked();
  });

  it("puts includeInactive=1 in the URL when ticked", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    expect(push).toHaveBeenCalledWith("/customers?includeInactive=1");
  });

  it("removes it from the URL when unticked, rather than setting it to 0", async () => {
    const user = userEvent.setup();
    seedUrl("includeInactive=1");
    render(<CustomerFilters selected={{ includeInactive: true }} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    // `/customers`, not `/customers?` — `commit` omits the separator for an
    // empty query rather than pushing a bare "?".
    expect(push).toHaveBeenCalledWith("/customers");
  });

  it("keeps an active search term when the toggle changes", async () => {
    const user = userEvent.setup();
    seedUrl("search=perez");
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    const [url] = push.mock.calls[0] as [string];
    expect(url).toContain("search=perez");
    expect(url).toContain("includeInactive=1");
  });

  // `applyFilter` drops `page` for every key except `pageSize`. Without that,
  // ticking the box while on page 3 would land on page 3 of a DIFFERENT result
  // set - usually empty, which reads as "there are none".
  it("returns to page 1 when the toggle changes", async () => {
    const user = userEvent.setup();
    seedUrl("page=3");
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));

    expect((push.mock.calls[0] as [string])[0]).not.toContain("page=3");
  });

  it("offers Limpiar once the toggle alone is on, not only after a search", () => {
    render(<CustomerFilters selected={{ includeInactive: true }} pageSize={10} />);
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
  it("keeps includeInactive when the search debounce fires after it", async () => {
    // Navigation SLOWER than the 300ms debounce. This is the case that
    // separates a correct fix from one that merely narrows the window: with a
    // fast mock, the URL lands before the timeout and even a
    // `window.location`-only read passes. On a server-component page the push
    // waits for the RSC payload over a list query that is a sequential scan,
    // so "slower than 300ms" is the realistic shape, not the exotic one.
    pending.delay = 450;
    const user = userEvent.setup();
    render(<CustomerFilters selected={{}} pageSize={10} />);

    await user.type(screen.getByLabelText(/Buscar/), "perez");
    // Inside the 300ms window — this is the interaction that lost the flag.
    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=perez");
    expect(last).toContain("includeInactive=1");
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
    seedUrl("includeInactive=1");
    render(<CustomerFilters selected={{ includeInactive: true }} pageSize={10} />);

    await user.click(screen.getByRole("checkbox", { name: "Ver desactivados" }));
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    // Before the clear's navigation lands — the ordinary "clear, then search
    // again" rhythm.
    await user.type(screen.getByLabelText(/Buscar/), "ana");
    await new Promise((resolve) => setTimeout(resolve, 350));

    const last = push.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain("search=ana");
    expect(last).not.toContain("includeInactive");
  });

  it("cancels a pending search instead of letting it re-push the cleared term", async () => {
    const user = userEvent.setup();
    pending.delay = 450;
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    await user.type(screen.getByLabelText(/Buscar/), "z");
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(push.mock.calls.at(-1)?.[0]).toBe("/customers");
  });

  it("empties the search box, so the screen matches the list it produced", async () => {
    const user = userEvent.setup();
    render(<CustomerFilters selected={{ search: "perez" }} pageSize={10} />);

    const input = screen.getByLabelText(/Buscar/) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(input.value).toBe("");
  });
});
