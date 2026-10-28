"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 30_000;
const TICK_MS = 10_000;

type Snapshot = { generatedAt: string; rows: unknown[] };

const looksLikeSnapshot = (v: unknown): v is Snapshot =>
  typeof v === "object" && v !== null && typeof (v as Snapshot).generatedAt === "string" && Array.isArray((v as Snapshot).rows);

/**
 * Keeps a board snapshot fresh. The server paints `initial`; this polls `url` every 30 s.
 * It does not pause for a hidden tab (a TV is always visible) and never overlaps requests.
 * A failed poll (network, non-2xx, a body that is not a snapshot) keeps the last good
 * snapshot and sets `failedAt`; 401 leaves for /login, 403 for / (the role-aware landing).
 * Plain timers and fetch only: the app is served over HTTP on the LAN.
 *
 * `seq` counts good snapshots (a failed poll leaves it alone); optimistic overrides settle against it
 * instead of comparing clocks. `refresh()` fetches now through the same guard as the poll: if a request
 * is in flight it runs once more right after, so it never overlaps and never adds a timer.
 */
export function useBoardSnapshot<T extends Snapshot>(url: string, initial: T) {
  const [state, setState] = useState<{ snapshot: T; lastOkAt: number; failedAt: number | null; seq: number }>(() => ({
    snapshot: initial,
    lastOkAt: Date.now(),
    failedAt: null,
    seq: 0,
  }));
  const fetchNow = useRef<() => void>(() => {});
  const refresh = useCallback(() => fetchNow.current(), []);

  // Live clock, running only while a failure is current: the banner measures against
  // it, not against the moment of the last failed poll (which can land at 59.6 s).
  const [tick, setTick] = useState(0);
  const failing = state.failedAt !== null;
  useEffect(() => {
    if (!failing) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [failing]);
  // A tick left over from an earlier failure is older than `failedAt`, so max() ignores it.
  const now = state.failedAt === null ? null : Math.max(tick, state.failedAt);

  useEffect(() => {
    let inFlight = false;
    let alive = true;
    let again = false;
    async function run() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 401 || res.status === 403) {
          clearInterval(id);
          again = false;
          location.assign(res.status === 401 ? "/login" : "/");
          return;
        }
        const body: unknown = res.ok ? await res.json() : null;
        if (!alive) return;
        if (!looksLikeSnapshot(body)) throw new Error("not a snapshot");
        setState((s) => ({ snapshot: body as T, lastOkAt: Date.now(), failedAt: null, seq: s.seq + 1 }));
      } catch {
        if (alive) setState((s) => ({ ...s, failedAt: Date.now() }));
      } finally {
        inFlight = false;
        if (again && alive) {
          again = false;
          void run();
        }
      }
    }
    const id = setInterval(run, POLL_MS);
    fetchNow.current = () => {
      if (inFlight) again = true;
      else void run();
    };
    return () => {
      alive = false;
      fetchNow.current = () => {};
      clearInterval(id);
    };
  }, [url]);

  return { ...state, now, refresh };
}
