"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const NON_TERMINAL = new Set(["pending", "uploading", "running"]);

/**
 * Refreshes server-rendered data (via `router.refresh()`) on an interval while
 * any item in `items` is in a non-terminal `uploadStatus`. Stops polling once
 * every item reaches a terminal status (or the list is empty).
 *
 * Only ONE component in a given screen should own this hook — mounting it
 * twice for the same data spins up two independent timers.
 */
export function usePollWhileActive<T extends { uploadStatus: string }>(
  items: T[],
  { intervalMs = 5000 }: { intervalMs?: number } = {},
): boolean {
  const router = useRouter();
  const hasActive = items.some((item) => NON_TERMINAL.has(item.uploadStatus));
  const ref = useRef(hasActive);

  useEffect(() => {
    ref.current = hasActive;
  }, [hasActive]);

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      if (ref.current) router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [hasActive, intervalMs, router]);

  return hasActive;
}
