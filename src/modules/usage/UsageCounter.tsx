"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { patternOf } from "@/modules/feedback/screen-labels";

/** One view per pathname change. A re-render, StrictMode, a query change or `router.refresh()` keeps the pathname, so none of them counts. */
export function UsageCounter() {
  const path = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (path === last.current) return;
    last.current = path;
    const screen = patternOf(path);
    if (screen === null) return;
    // A view is not an operator mutation (design D7): no toast, no retry, failure is silent.
    fetch("/api/usage/view", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen }),
    }).catch(() => {});
  }, [path]);

  return null;
}
