"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Re-reads this page's server render on demand. Several people look at the
 * same orders from different machines over the workshop LAN (AGENTS.md), so a
 * list is stale for everyone except whoever last saved — and the operator
 * asked for a way to re-read it that is not the browser's reload, which throws
 * away the URL's filters, sort and page along with the paint.
 *
 * `useTransition`, not the `useState` flag `OrderStatusControls` uses beside
 * its `await fetch`: `router.refresh()` returns void and settles whenever the
 * server render lands, so a hand-rolled flag would either never clear or clear
 * on a timer that means nothing. Inside `startTransition` the router's update
 * is entangled with the transition, so `isRefreshing` is true for exactly as
 * long as the re-render actually takes.
 *
 * NO TOAST, deliberately. AGENTS.md's rule is that every MUTATION tells the
 * operator it happened; this writes nothing, and its result is the list itself
 * — a toast would announce a change that may not exist. The pending label and
 * the disabled trigger are the "something is happening", exactly as
 * `ManualSyncButton` does it.
 */
export function RefreshListButton() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      /* AGENTS.md's 44x44 floor over `size="default"`'s `h-8` — this is an
         action control, and the list is opened from a tablet. */
      className="min-h-11 min-w-11"
      disabled={isRefreshing}
      onClick={() => startRefresh(() => router.refresh())}
    >
      <RefreshCw className={isRefreshing ? "animate-spin" : undefined} aria-hidden="true" />
      {isRefreshing ? "Actualizando…" : "Actualizar"}
    </Button>
  );
}
