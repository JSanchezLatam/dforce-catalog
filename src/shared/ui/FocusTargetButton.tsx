"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Scrolls to and focuses an element elsewhere on the page. Takes the target's id
 * (a string), so a Server Component can render it; the DOM is read in the click
 * handler, never during render, so there is no hydration risk.
 */
export function FocusTargetButton({ targetId, children }: { targetId: string; children: ReactNode }) {
  function focusTarget() {
    const el = document.getElementById(targetId);
    if (!el) return;
    // Optional call: jsdom lacks it, and the real scroll is verified in a browser.
    el.scrollIntoView?.({ block: "center" });
    el.focus({ preventScroll: true });
  }

  return (
    <Button type="button" variant="outline" className="min-h-11 min-w-11" onClick={focusTarget}>
      {children}
    </Button>
  );
}
