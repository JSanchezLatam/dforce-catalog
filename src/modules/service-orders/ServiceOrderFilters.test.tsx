/**
 * Did not exist before this change (checked directly). WU2 adds this
 * screen's search box; Phase 1 only needs status/pageSize/Limpiar routed
 * through the one hook so that later search box cannot become a second
 * writer on this screen (design.md D1, "the fourth call site").
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const listeners = vi.hoisted(() => new Set<() => void>());
const pending = vi.hoisted(() => ({
  timers: [] as ReturnType<typeof setTimeout>[],
  delay: 20,
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
    pending.timers.push(setTimeout(() => land(url), pending.delay));
  }),
);
vi.mock("next/navigation", async () => {
  const { useReducer, useEffect } = await import("react");
  return {
    useRouter: () => ({ push }),
    usePathname: () => "/service-orders",
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

import { ServiceOrderFilters } from "./ServiceOrderFilters";

function seedUrl(query: string) {
  searchParams.value = new URLSearchParams(query);
  window.history.replaceState({}, "", query ? `/service-orders?${query}` : "/service-orders");
}

afterEach(() => {
  pending.delay = 20;
  for (const timer of pending.timers) clearTimeout(timer);
  pending.timers = [];
  push.mockClear();
  searchParams.value = new URLSearchParams();
  window.history.replaceState({}, "", "/service-orders");
});

describe("ServiceOrderFilters — status select routes through the one hook", () => {
  it("pushes the chosen status immediately", async () => {
    const user = userEvent.setup();
    render(<ServiceOrderFilters selected={{}} pageSize={10} />);

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "Completada" }));

    expect(push).toHaveBeenCalledWith("/service-orders?status=done");
  });
});

/**
 * `Limpiar` used to bypass `applyFilter` with its own `router.push(pathname)`
 * (`:58`) — a second writer, the exact shape D6 removes.
 *
 * The name below says only what this test can check. Its first draft claimed
 * "…not a standalone router.push", and a standalone push keeps it green — this
 * screen has no debounce to cancel until WU2 gives it a search box, so the two
 * writers produce an identical URL. Documenting a placebo is not this repo's
 * rule; naming the test after what it actually proves is.
 */
describe("ServiceOrderFilters — Limpiar goes through the hook's clearAll", () => {
  it("clears the status filter, pushing the bare pathname exactly once", async () => {
    const user = userEvent.setup();
    pending.delay = 450; // navigation slower than any debounce, as in production
    seedUrl("status=done");
    render(<ServiceOrderFilters selected={{ status: "done" }} pageSize={10} />);

    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(push).toHaveBeenCalledWith("/service-orders");
    expect(push).toHaveBeenCalledTimes(1); // one writer, not two
  });
});

/**
 * D5 names `/customers` AND `/service-orders` as the two screens whose
 * behaviour changes — `applyFilter` drops `page` on a `pageSize` change, where
 * both previously exempted it. Round 3 covered `/customers` and left this one,
 * the same one-sibling-patched shape the rest of this unit kept hitting.
 *
 * Staying on page 7 while the page size changes shows a slice of a list that
 * no longer exists.
 */
describe("ServiceOrderFilters — page is dropped on every filter change (D5)", () => {
  it("drops page when pageSize changes", async () => {
    const user = userEvent.setup();
    seedUrl("page=7&status=done");
    render(<ServiceOrderFilters selected={{ status: "done" }} pageSize={10} />);

    // By render order, not by name: this screen's `Select`/`Label` pairs carry
    // no `htmlFor`/`id`, so Base UI gives the trigger no accessible name.
    // `Estado` renders first, `Filas por página` last.
    await user.click(screen.getAllByRole("combobox").at(-1)!);
    await user.click(await screen.findByRole("option", { name: "50" }));

    const url = String(push.mock.calls.at(-1)?.[0]);
    expect(url).toContain("pageSize=50");
    expect(url).not.toContain("page=7");
  });
});
