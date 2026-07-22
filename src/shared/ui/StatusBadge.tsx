/**
 * Kanagawa Dragon status badge (design.md — "Status badge mapping").
 * Pure color mapping so both `sync_status` (inventory-sync) and
 * `upload_status` (catalog-storage) render the same confirmed pill style,
 * without either module depending on the other.
 */
export type BadgeStatus = "running" | "completed" | "pending" | "uploading" | "uploaded" | "failed";

const STATUS_BG: Record<BadgeStatus, string> = {
  running: "bg-dragon-yellow",
  uploading: "bg-dragon-yellow",
  completed: "bg-dragon-green",
  uploaded: "bg-dragon-green",
  failed: "bg-dragon-red",
  pending: "bg-dragon-muted",
};

/** Extracted for unit testing — pure `status -> className` mapping, no JSX. */
export function statusBadgeClassName(status: BadgeStatus): string {
  return `inline-block rounded-full px-2 py-0.5 text-xs font-medium text-dragon-sidebar-bg ${STATUS_BG[status]}`;
}

export function StatusBadge({ status, label }: { status: BadgeStatus; label: string }) {
  return <span className={statusBadgeClassName(status)}>{label}</span>;
}
