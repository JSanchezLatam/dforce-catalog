import { redirect } from "next/navigation";

import { getFeedback, isUuid, listFeedback, markRead, parseFilters, statusCounts } from "../../src/support/queries";
import { requireSupport } from "../../src/support/session";
import { FeedbackDetailPane } from "./FeedbackDetailPane";
import { FeedbackList } from "./FeedbackList";
import { InboxFilters } from "./InboxFilters";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";

// Listing never writes: marking a comment read belongs to opening it (?id=), not to this render.
// Order matters: mark first, so the counts and the pane both read the row as already read.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await requireSupport())) redirect("/support/login");
  const params = await searchParams;
  const filters = parseFilters(params);
  const id = params.id === undefined ? undefined : (isUuid(params.id) ? params.id : null);
  if (id) await markRead(id);
  const [rows, counts, selected] = await Promise.all([listFeedback(filters), statusCounts(), id ? getFeedback(id) : undefined]);
  const empty = counts.nuevo + counts.leido + counts.resuelto === 0;

  return (
    <>
      <header className="masthead">
        <div className="bar">
          <p className="brand">Soporte — Dforce</p>
          <LogoutButton />
        </div>
      </header>
      <main className="page wide" data-detail={id !== undefined}>
        <h1 className="title">Comentarios del taller</h1>
        {empty ? (
          <div className="card pempty">
            <h2 className="title">No hay comentarios</h2>
            <p className="muted">Cuando alguien del taller envíe uno, aparece acá.</p>
          </div>
        ) : (
          <>
            <InboxFilters filters={filters} counts={counts} />
            <div className="inbox">
              <div className="inbox-list">
                {rows.length ? (
                  <FeedbackList rows={rows} filters={filters} />
                ) : (
                  <div className="card pempty">
                    <h2 className="title">Ningún comentario coincide con los filtros</h2>
                    <a href="/support" className="btn ghost">
                      Limpiar filtros
                    </a>
                  </div>
                )}
              </div>
              <FeedbackDetailPane picked={id !== undefined} row={selected} filters={filters} />
            </div>
          </>
        )}
      </main>
    </>
  );
}
