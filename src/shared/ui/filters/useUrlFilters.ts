"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The one writer for a list screen's URL-driven filters (design.md D1/D3).
 *
 * `CustomerFilters.tsx` documented two shipped-and-reverted attempts at this
 * exact race before this hook existed — moved here VERBATIM, not redesigned,
 * because nothing about the race changed by moving it. A component that owned
 * its own `router.push` in ADDITION to this hook would re-open the same bug a
 * third time; this hook is the only thing on a screen allowed to call it.
 */
export type UrlFilters = {
  /** Local text state, authoritative while typing (never overwritten by our own push landing). */
  text: Record<string, string>;
  /** Keystroke: updates `text` immediately, pushes after `debounceMs`, one timer per key (D4). */
  setText: (key: string, value: string) => void;
  /** Selects and anything else with no keystrokes to wait out — pushes immediately. */
  applyFilter: (key: string, value: string) => void;
  /** Cancels every pending timer, empties `text`, pushes the bare pathname. Never touches the DOM. */
  clearAll: () => void;
};

export function useUrlFilters(initialText: Record<string, string>, debounceMs = 300): UrlFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Lazy: the caller rebuilds `initialText` as a fresh object literal every
  // render, and seeding from it on every render would re-seed mid-typing (D3).
  const [text, setTextState] = useState(() => initialText);

  /** One timer per key (D4) — a single shared timer clobbers across a screen's
   *  second text field: typing `ID` then `Nombre` inside the debounce window
   *  cleared the first timer and the `ID` value was never pushed at all. */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * `applyFilter` is the ONLY writer of this screen's query string, so the
   * params it last pushed are authoritative the instant it pushes them. That
   * is what makes this ref synchronous by construction, and it is the only
   * thing here that is.
   *
   * Two earlier attempts were both wrong, and the second one shipped:
   *
   *  1. Reading `searchParams` from the closure. The debounced call schedules
   *     that closure `debounceMs` out, so a push landing inside the window was
   *     overwritten by the stale snapshot — the operator ticked a filter and
   *     watched it come back unticked.
   *  2. Reading `window.location.search` at fire time, claiming it is
   *     "current by definition". It is not. In Next 16, `router.push` only
   *     dispatches into the React action queue; `window.history.pushState`
   *     runs from a `useEffect` keyed on `appRouterState`
   *     (`next/dist/client/components/app-router.js:64,70`), so the URL lands
   *     only after React commits the navigation — which on a server-component
   *     page means after the RSC payload arrives. That turned a 300ms race
   *     against a re-render into a 300ms race against a network round trip.
   *     Narrower, not closed.
   *
   * `null` means "no push of ours is outstanding, trust the URL". The effect
   * resets it when an EXTERNAL navigation changes `searchParams` — a back
   * button or a `<Link>` — which is the one case that is not racing a
   * debounce the user just started.
   */
  const pushedParamsRef = useRef<URLSearchParams | null>(null);
  /**
   * How many of OUR pushes have not committed yet. Releasing the ref on the
   * first navigation to land is wrong whenever two were outstanding:
   * `useSearchParams()` reflects the COMMITTED url, so push A landing would
   * null the ref that was holding push B, and the next debounce would rebuild
   * from a URL that still showed A.
   *
   * Only the LAST of our pushes releases it. An external navigation — back
   * button, `<Link>` — arrives with the counter at zero and releases it
   * immediately, which is the case this effect is actually for.
   */
  const pendingPushes = useRef(0);

  function reseedTextFromSearchParams() {
    setTextState((prev) => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(prev)) next[key] = searchParams.get(key) ?? "";
      return next;
    });
  }

  /**
   * A pending debounce outliving the component pushes the user off the page
   * they navigated to: type in the search box, click a sidebar link inside the
   * window, and the timer fires against the pathname it captured. Pre-existing
   * in `CustomerFilters` and moved here, which is exactly why it is closed now
   * — this is one path for three screens instead of one screen's problem.
   */
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /**
   * The effect below also runs on MOUNT, with the counter at zero — so without
   * this guard it reads the first render as an external navigation and
   * overwrites the lazily-seeded `initialText` with raw `searchParams`.
   *
   * That is not cosmetic. `/inventory?id=A&id=B`: the page's
   * `typeof params.id === "string"` guard leaves `selected.id` undefined, so
   * the LIST is unfiltered — while `searchParams.get("id")` returns `"A"`, so
   * the BOX would show a filter that is not applied. The screen disagreeing
   * with the list it produced is the class this whole unit exists to close,
   * and re-seeding on mount reintroduces it. `initialText` already carries the
   * caller's own normalisation; the URL does not.
   */
  const mounted = useRef(false);

  useEffect(() => {
    // Read BEFORE the decrement (D3) — `wasOurs` is not new information, it
    // is the counter's existing meaning read one line earlier.
    const wasOurs = pendingPushes.current > 0;
    if (wasOurs) pendingPushes.current -= 1;
    if (pendingPushes.current === 0) pushedParamsRef.current = null;
    // Our own push landing must not overwrite text the user typed since —
    // only an EXTERNAL navigation (arrives with the counter at zero) re-seeds.
    if (!mounted.current) {
      mounted.current = true; // first run is the mount, not a navigation
    } else if (!wasOurs) {
      reseedTextFromSearchParams();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /**
   * The ONE `router.push` in this hook, and that is the point rather than a
   * coincidence. An invariant asserted in prose is not an invariant — this
   * makes a second writer something a screen would have to add a second
   * `router.push` to create.
   */
  function commit(params: URLSearchParams) {
    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;

    pushedParamsRef.current = params;
    // Only count a push that will actually CHANGE the url: a push to the url
    // we are already on produces no new `searchParams`, so the effect above
    // never fires for it and the increment would never come back down.
    if (href !== `${pathname}${window.location.search}`) {
      pendingPushes.current += 1;
    }
    router.push(href);
  }

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(pushedParamsRef.current ?? window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    // D5 — `page` is dropped on every filter change, `pageSize` included: a
    // `pageSize` change invalidates the page index arithmetically.
    params.delete("page");
    commit(params);
  }

  function setText(key: string, value: string) {
    setTextState((prev) => ({ ...prev, [key]: value }));
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        applyFilter(key, value);
      }, debounceMs),
    );
  }

  /**
   * Cancels every pending timer, unlike `applyFilter`. An immediate filter
   * must NOT cancel a debounced one — typing a term and then ticking a select
   * has to keep both — but clearing must, or a timer fires afterwards and
   * re-pushes the very term the operator just cleared.
   */
  function clearAll() {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    // Keys kept, values emptied — NOT `{}`. `reseedTextFromSearchParams`
    // rebuilds over the keys already in state, so clearing them would disable
    // the re-seed permanently: Limpiar, then Back, and the list returns
    // filtered while the box stays empty. That is this change's own defect
    // class, and it would have shipped on all three screens.
    setTextState((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, ""])));
    commit(new URLSearchParams());
  }

  return { text, setText, applyFilter, clearAll };
}
