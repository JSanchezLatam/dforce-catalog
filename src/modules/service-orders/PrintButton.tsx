"use client";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * The one client boundary on the printed work order (design D8).
 *
 * Zero props — nothing crosses the RSC boundary at all, not even a string.
 *
 * NO `useEffect` auto-print and NO `typeof document` gate. AGENTS.md names
 * that gate as React's documented cause #1 for a hydration mismatch, and it
 * already shipped in this repo once (a portal behind `typeof document !==
 * "undefined"`), surviving months of a green suite because jsdom's `render()`
 * takes the client snapshot directly instead of a server render plus
 * `hydrateRoot`. `window.print` is only ever read inside the click handler,
 * which runs in the browser by construction.
 *
 * `buttonVariants` on a plain `<button>` rather than `<Button>`, matching
 * `RowActions`/`OrderBulkStatusActions`, and `min-h-11 min-w-11` for
 * AGENTS.md's 44x44 floor over `size="default"`'s `h-8`.
 *
 * `print:hidden` keeps the control off the paper. jsdom applies no `@media
 * print` rule, so no test can prove that — task 3.12's print preview does.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(buttonVariants({ variant: "outline", size: "default" }), "min-h-11 min-w-11 print:hidden")}
    >
      Imprimir
    </button>
  );
}
