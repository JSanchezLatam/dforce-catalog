import { CATEGORY_LABELS, ROLE_LABELS, STATUS_LABELS, type Status } from "../../src/support/format";
import { queryString, type Filters } from "../../src/support/queries";

/** Everything is a URL: status are links, category and role a plain GET form, so no client state. */
export function InboxFilters({ filters, counts }: { filters: Filters; counts: Record<Status, number> }) {
  const total = counts.nuevo + counts.leido + counts.resuelto;
  const tabs: [Status | undefined, string, number][] = [
    [undefined, "Todos", total],
    ...(Object.keys(STATUS_LABELS) as Status[]).map((s): [Status, string, number] => [s, STATUS_LABELS[s], counts[s]]),
  ];
  return (
    <form className="filters" method="get" action="/support">
      <div className="psel">
        <span>Estado</span>
        <div className="pseg" role="group" aria-label="Filtrar por estado">
          {tabs.map(([status, label, n]) => (
            <a
              key={label}
              href={`/support${queryString({ ...filters, status })}`}
              aria-current={filters.status === status ? "true" : undefined}
            >
              {label} ({n})
            </a>
          ))}
        </div>
      </div>
      {filters.status && <input type="hidden" name="status" value={filters.status} />}
      <label className="psel">
        Tipo
        <select name="category" defaultValue={filters.category ?? ""}>
          <option value="">Todos</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="psel">
        Rol
        <select name="role" defaultValue={filters.role ?? ""}>
          <option value="">Todos</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn ghost">
        Filtrar
      </button>
    </form>
  );
}
