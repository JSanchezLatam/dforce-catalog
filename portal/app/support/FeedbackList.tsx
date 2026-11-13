import { CATEGORY_LABELS, ROLE_LABELS, STATUS_LABELS, formatPanama, isDelayed } from "../../src/support/format";
import { queryString, type FeedbackListRow, type Filters } from "../../src/support/queries";

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key;

export function FeedbackList({ rows, filters }: { rows: FeedbackListRow[]; filters: Filters }) {
  return (
    <ul className="plist">
      {rows.map((r) => (
        <li key={r.id}>
          {/* A plain link, not next/link: opening ?id= marks a Nuevo row read, so it must never be prefetched,
              and the full load re-renders the support layout, whose Nuevo counter would otherwise go stale. */}
          <a href={`/support${queryString(filters, r.id)}`} className={`prow${r.status === "nuevo" ? " unread" : ""}`}>
            <span className="l1">
              <span className="cat-t">{label(CATEGORY_LABELS, r.category)}</span>
              <span className="chip" data-status={label(STATUS_LABELS, r.status)}>
                {label(STATUS_LABELS, r.status)}
              </span>
            </span>
            <span className="l2">
              <span>
                {r.username} · {label(ROLE_LABELS, r.role)}
              </span>
              <span>{r.screenLabel}</span>
            </span>
            <span className="l3">
              <span>Recibido {formatPanama(r.receivedAt)}</span>
              {isDelayed(r.createdAt, r.receivedAt) && <span className="delay">Llegó con demora · escrito {formatPanama(r.createdAt)}</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
