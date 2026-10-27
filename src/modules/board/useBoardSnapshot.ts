"use client";

import { useEffect, useState } from "react";

const POLL_MS = 30_000;

type Snapshot = { generatedAt: string; rows: unknown[] };

const looksLikeSnapshot = (v: unknown): v is Snapshot =>
  typeof v === "object" && v !== null && typeof (v as Snapshot).generatedAt === "string" && Array.isArray((v as Snapshot).rows);

/**
 * Keeps a board snapshot fresh. The server paints `initial`; this polls `url` every 30 s.
 * It does not pause for a hidden tab (a TV is always visible) and never overlaps requests.
 * A failed poll (network, non-2xx, a body that is not a snapshot) keeps the last good
 * snapshot and sets `failedAt`; 401 leaves for /login, 403 for / (the role-aware landing).
 * Plain timers and fetch only: the app is served over HTTP on the LAN.
 */
export function useBoardSnapshot<T extends Snapshot>(url: string, initial: T) {
  const [state, setState] = useState<{ snapshot: T; lastOkAt: number; failedAt: number | null }>(() => ({
    snapshot: initial,
    lastOkAt: Date.now(),
    failedAt: null,
  }));

  useEffect(() => {
    let inFlight = false;
    let alive = true;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 401 || res.status === 403) {
          clearInterval(id);
          location.assign(res.status === 401 ? "/login" : "/");
          return;
        }
        const body: unknown = res.ok ? await res.json() : null;
        if (!alive) return;
        if (!looksLikeSnapshot(body)) throw new Error("not a snapshot");
        setState({ snapshot: body as T, lastOkAt: Date.now(), failedAt: null });
      } catch {
        if (alive) setState((s) => ({ ...s, failedAt: Date.now() }));
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url]);

  return state;
}
