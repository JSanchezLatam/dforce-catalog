"use client";

import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter";
import type { CSSProperties } from "react";

import { ORDER_HUE } from "@/shared/ui/status-hue";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { BacklogStatus } from "../shape";
import scope from "./arc-scope.module.css";

// The dot wears the same board hue as the order's badge (`ORDER_HUE`), through `board-hue-bar`.
// It is never the only carrier: every tile also names its status in words.
const TILES: { status: BacklogStatus; label: string }[] = [
  { status: "booked", label: ORDER_STATUS_LABEL.booked },
  { status: "open", label: ORDER_STATUS_LABEL.open },
  { status: "diagnosing", label: ORDER_STATUS_LABEL.diagnosing },
  { status: "in_progress", label: ORDER_STATUS_LABEL.in_progress },
  { status: "on_hold", label: ORDER_STATUS_LABEL.on_hold },
  { status: "ready_for_review", label: ORDER_STATUS_LABEL.ready_for_review },
];

/** Client wrapper: the count rolls up the first time the tile scrolls into view. Arc's counter honours reduced motion and keeps the exact number for screen readers. */
export function BacklogCounters({ counts }: { counts: Record<BacklogStatus, number> }) {
  return (
    <dl className={`${scope.scope} grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3`}>
      {TILES.map(({ status, label }) => (
        <div key={status} className="rounded-xl border bg-card p-3 text-card-foreground sm:p-4">
          <dt className="flex items-start gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <span aria-hidden="true" className="board-hue-bar mt-1 size-2 shrink-0 rounded-full"
              style={{ "--h": String(ORDER_HUE[status].h), "--s": ORDER_HUE[status].s } as CSSProperties} />
            {label}
          </dt>
          <dd className="mt-1">
            <AnimatedCounter value={counts[status]} locale="es-PA" animateOnView />
          </dd>
        </div>
      ))}
    </dl>
  );
}
