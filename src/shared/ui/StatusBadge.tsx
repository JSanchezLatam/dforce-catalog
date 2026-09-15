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

const STATUS_BG: Record<BadgeStatus, string> = {
  running: "bg-warning",
  uploading: "bg-warning",
  completed: "bg-success",
  uploaded: "bg-success",
  failed: "bg-destructive",
  pending: "bg-muted",
  open: "bg-muted",
  in_progress: "bg-warning",
  done: "bg-success",
  cancelled: "bg-muted",
  scheduled: "bg-muted",
  sent: "bg-success",
  skipped: "bg-muted",
  opted_out: "bg-muted",
};

const STATUS_FG: Record<BadgeStatus, string> = {
  running: "text-warning-foreground",
  uploading: "text-warning-foreground",
  completed: "text-success-foreground",
  uploaded: "text-success-foreground",
  failed: "text-destructive-foreground",
  pending: "text-muted-foreground",
  open: "text-muted-foreground",
  in_progress: "text-warning-foreground",
  done: "text-success-foreground",
  cancelled: "text-muted-foreground",
  scheduled: "text-muted-foreground",
  sent: "text-success-foreground",
  skipped: "text-muted-foreground",
  opted_out: "text-muted-foreground",
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
  return `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BG[status]} ${STATUS_FG[status]}${isAnimated(status) ? " animate-pulse" : ""}`;
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
