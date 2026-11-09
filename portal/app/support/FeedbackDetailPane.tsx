import { CATEGORY_LABELS, ROLE_LABELS, STATUS_LABELS, formatPanama, isDelayed } from "../../src/support/format";
import { queryString, type FeedbackDetail, type Filters } from "../../src/support/queries";
import { FeedbackEditor } from "./FeedbackEditor";

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key;

/** `picked` is "the URL had an ?id=": a row that is missing then reads as not found, not as "nothing chosen". */
export function FeedbackDetailPane({ picked, row, filters }: { picked: boolean; row?: FeedbackDetail; filters: Filters }) {
  // A plain link, not a button: on a phone the detail replaces the list and this is the way back.
  const back = (
    <a href={`/support${queryString(filters)}`} className="back">
      Volver
    </a>
  );
  return (
    <aside className="card pdet" aria-label="Detalle del comentario">
      {!picked ? (
        <p className="muted">Elegí un comentario de la lista.</p>
      ) : !row ? (
        <>
          {back}
          <p className="muted">No encontramos ese comentario.</p>
        </>
      ) : (
        <>
          {back}
          <div className="hd">
            <h2>{label(CATEGORY_LABELS, row.category)}</h2>
            <span className="chip" data-status={label(STATUS_LABELS, row.status)}>
              {label(STATUS_LABELS, row.status)}
            </span>
          </div>
          <dl>
            <dt>Autor</dt>
            <dd>
              {row.username} · {label(ROLE_LABELS, row.role)}
            </dd>
            <dt>Pantalla</dt>
            <dd>{row.screenLabel}</dd>
            <dt>Escrito</dt>
            <dd>{formatPanama(row.createdAt)}</dd>
            <dt>Recibido</dt>
            <dd>
              {formatPanama(row.receivedAt)}
              {isDelayed(row.createdAt, row.receivedAt) && <span className="delay">Llegó con demora: estuvo en cola sin internet</span>}
            </dd>
          </dl>
          <p className="ptext">{row.text}</p>
          {/* key: switching rows must reset the draft note and the confirmation. */}
          <FeedbackEditor key={row.id} id={row.id} status={row.status} note={row.internalNote} />
        </>
      )}
    </aside>
  );
}
