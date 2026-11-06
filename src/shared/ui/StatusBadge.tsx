import { Ban, BellOff, CalendarClock, CheckCircle, ClipboardCheck, Clock, Loader2, MinusCircle, PauseCircle, Search, XCircle, type LucideIcon } from "lucide-react";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { ORDER_HUE, type HuedOrderStatus } from "./status-hue";

export type BadgeStatus =
  | "running"
  | "completed"
  | "pending"
  | "uploading"
  | "uploaded"
  | "failed"
  // A non-order amber chip (vencimientos "Este mes" / "En N días").
  | "warning"
  // order_status (R21, Phase 6 — service-orders/[id] page)
  | "booked"
  | "open"
  | "diagnosing"
  | "in_progress"
  | "on_hold"
  | "ready_for_review"
  | "done"
  | "cancelled"
  // reminder_status (R24/R25/R26, Phase 6 — service-orders/[id] reminders list)
  | "scheduled"
  | "sent"
  | "skipped"
  | "opted_out";

/**
 * Audit #6: the old chips were white ink on `bg-success` / `bg-warning` (mid
 * green and amber), under 4.5:1 in BOTH themes. Each family is the approved
 * mockup's `CHIP` entry: dark ink on a pale tint in light, light ink on a
 * translucent tint in dark, the pattern `badge.tsx`'s destructive variant set.
 * `failed` has no mockup entry; it takes the same recipe in red. Ratios are
 * measured in the browser (jsdom computes no colour), not taken from the palette.
 */
const TONE = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  success: "bg-green-100 text-green-800 dark:bg-green-400/15 dark:text-green-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300",
} as const;

/**
 * The seven order statuses wear their board hue (`.hue-tint`, vars set inline by `StatusBadge`);
 * `cancelled` keeps its neutral struck-through chip. A caller using `statusBadgeClassName` with an
 * order status must set `--h`/`--s` itself - none does today.
 */
const HUE_TINT = "hue-tint";

const STATUS_TONE: Record<BadgeStatus, string> = {
  running: TONE.warning,
  uploading: TONE.warning,
  completed: TONE.success,
  uploaded: TONE.success,
  failed: TONE.danger,
  warning: TONE.warning,
  pending: TONE.neutral,
  booked: HUE_TINT,
  open: HUE_TINT,
  diagnosing: HUE_TINT,
  in_progress: HUE_TINT,
  on_hold: HUE_TINT,
  ready_for_review: HUE_TINT,
  done: HUE_TINT,
  // Struck through, as in the mockup: neutral grey alone reads the same as "open".
  cancelled: `${TONE.neutral} line-through decoration-1`,
  scheduled: TONE.neutral,
  sent: TONE.success,
  skipped: TONE.neutral,
  opted_out: TONE.neutral,
};

const STATUS_ICON: Record<BadgeStatus, LucideIcon> = {
  running: Loader2,
  uploading: Loader2,
  completed: CheckCircle,
  uploaded: CheckCircle,
  failed: XCircle,
  warning: Clock,
  pending: Clock,
  booked: CalendarClock,
  open: Clock,
  diagnosing: Search,
  in_progress: Loader2,
  on_hold: PauseCircle,
  ready_for_review: ClipboardCheck,
  done: CheckCircle,
  cancelled: Ban,
  scheduled: Clock,
  sent: CheckCircle,
  skipped: MinusCircle,
  opted_out: BellOff,
};

function isAnimated(status: BadgeStatus): boolean {
  return status === "running" || status === "uploading";
}

export function statusBadgeClassName(status: BadgeStatus): string {
  return `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}${isAnimated(status) ? " animate-pulse" : ""}`;
}

/**
 * `className` exists for callers that sit beside something taller or must not
 * wrap: `ManualSyncButton` (reason in `StatusBadge.test.tsx`: this chip is 20px,
 * the same as shadcn's `Badge` `h-5`, right in a table cell, a heading or a grid
 * card's footer (`CatalogGrid.tsx:60`), and short only beside that toolbar's
 * `h-8` Button) and the phone cards (service orders, customers, order history),
 * which add `shrink-0` so the chip keeps its width. Growing the component
 * itself would add height to every service-order, reminder, customer and
 * vehicle row to fix one toolbar.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: BadgeStatus;
  label: string;
  className?: string;
}) {
  const Icon = STATUS_ICON[status];
  const hue = status in ORDER_HUE ? ORDER_HUE[status as HuedOrderStatus] : undefined;
  return (
    <span
      className={cn(statusBadgeClassName(status), className)}
      style={hue ? ({ "--h": String(hue.h), "--s": hue.s } as CSSProperties) : undefined}
    >
      <Icon aria-hidden="true" size={14} className={isAnimated(status) ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
