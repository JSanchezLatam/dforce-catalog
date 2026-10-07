import type { BacklogStatus } from "./shape";

// The dot follows `StatusBadge`'s tone families (open neutral, the other two amber).
// It is never the only carrier: every tile also names its status in words.
const TILES: { status: BacklogStatus; label: string; dot: string }[] = [
  { status: "open", label: "Abiertas", dot: "bg-zinc-400" },
  { status: "in_progress", label: "En progreso", dot: "bg-amber-500" },
  { status: "ready_for_review", label: "Lista para revisión", dot: "bg-amber-500" },
];

export function BacklogTiles({ counts }: { counts: Record<BacklogStatus, number> }) {
  return (
    <dl className="grid grid-cols-3 gap-2 sm:gap-3">
      {TILES.map(({ status, label, dot }) => (
        <div key={status} className="rounded-xl border bg-card p-3 text-card-foreground sm:p-4">
          <dt className="flex items-start gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <span aria-hidden="true" className={`mt-1 size-2 shrink-0 rounded-full ${dot}`} />
            {label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{counts[status]}</dd>
        </div>
      ))}
    </dl>
  );
}
