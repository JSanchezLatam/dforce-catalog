/**
 * dash-* status badge (v2 redesign — supersedes the Kanagawa Dragon mapping
 * from PR1-6, same status semantics, new palette).
 * Pure color mapping so both `sync_status` (inventory-sync) and
 * `upload_status` (catalog-storage) render the same confirmed pill style,
 * without either module depending on the other.
 */
export type BadgeStatus = "running" | "completed" | "pending" | "uploading" | "uploaded" | "failed";

const STATUS_BG: Record<BadgeStatus, string> = {
  running: "bg-dash-gold",
  uploading: "bg-dash-gold",
  completed: "bg-dash-green",
  uploaded: "bg-dash-green",
  failed: "bg-dash-red",
  pending: "bg-dash-muted",
};

/** Extracted for unit testing — pure `status -> className` mapping, no JSX. */
export function statusBadgeClassName(status: BadgeStatus): string {
  return `inline-block rounded-full px-2 py-0.5 text-xs font-medium text-dash-card ${STATUS_BG[status]}`;
}

export function StatusBadge({ status, label }: { status: BadgeStatus; label: string }) {
  return <span className={statusBadgeClassName(status)}>{label}</span>;
}
