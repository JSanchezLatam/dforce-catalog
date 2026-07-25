import { CheckCircle, Clock, Loader2, XCircle, type LucideIcon } from "lucide-react";

export type BadgeStatus = "running" | "completed" | "pending" | "uploading" | "uploaded" | "failed";

const STATUS_BG: Record<BadgeStatus, string> = {
  running: "bg-warning",
  uploading: "bg-warning",
  completed: "bg-success",
  uploaded: "bg-success",
  failed: "bg-destructive",
  pending: "bg-muted",
};

const STATUS_FG: Record<BadgeStatus, string> = {
  running: "text-warning-foreground",
  uploading: "text-warning-foreground",
  completed: "text-success-foreground",
  uploaded: "text-success-foreground",
  failed: "text-destructive-foreground",
  pending: "text-muted-foreground",
};

const STATUS_ICON: Record<BadgeStatus, LucideIcon> = {
  running: Loader2,
  uploading: Loader2,
  completed: CheckCircle,
  uploaded: CheckCircle,
  failed: XCircle,
  pending: Clock,
};

function isAnimated(status: BadgeStatus): boolean {
  return status === "running" || status === "uploading";
}

export function statusBadgeClassName(status: BadgeStatus): string {
  return `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BG[status]} ${STATUS_FG[status]}${isAnimated(status) ? " animate-pulse" : ""}`;
}

export function StatusBadge({ status, label }: { status: BadgeStatus; label: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={statusBadgeClassName(status)}>
      <Icon aria-hidden="true" size={14} className={isAnimated(status) ? "animate-spin" : ""} />
      {label}
    </span>
  );
}
