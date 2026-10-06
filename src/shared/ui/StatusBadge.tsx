import { Ban, BellOff, CheckCircle, Clock, Loader2, MinusCircle, XCircle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "running"
  | "completed"
  | "pending"
  | "uploading"
  | "uploaded"
  | "failed"
  // order_status (R21, Phase 6 — service-orders/[id] page)
  | "open"
  | "in_progress"
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
  danger: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300",
} as const;

const STATUS_TONE: Record<BadgeStatus, string> = {
  running: TONE.warning,
  uploading: TONE.warning,
  completed: TONE.success,
  uploaded: TONE.success,
  failed: TONE.danger,
  pending: TONE.neutral,
  open: TONE.neutral,
  in_progress: TONE.warning,
  done: TONE.success,
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
  pending: Clock,
  open: Clock,
  in_progress: Loader2,
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
 * `className` exists for ONE caller, `ManualSyncButton`, and the reason is in
 * `StatusBadge.test.tsx`: this chip is 20px (the same as shadcn's `Badge`
 * `h-5`), which is right in the five places it sits in a table cell, inline in
 * a heading, or in a grid card's footer (`CatalogGrid.tsx:60` is that last
 * one), and short only beside `ManualSyncButton`'s `h-8` Button. Growing the component
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
  return (
    <span className={cn(statusBadgeClassName(status), className)}>
      <Icon aria-hidden="true" size={14} className={isAnimated(status) ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
