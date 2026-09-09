import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, Wrench } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { computePageWindow, listInventory, parsePageSize } from "@/modules/inventory-view/queries";
import { OrderBulkStatusActions } from "@/modules/service-orders/OrderBulkStatusActions";
import { ServiceOrderFilters } from "@/modules/service-orders/ServiceOrderFilters";
import { ServiceOrderFormTrigger } from "@/modules/service-orders/ServiceOrderFormTrigger";
import {
  countOrdenesServicio,
  listOrdenesServicio,
  ORDEN_SORT,
  parseOrdenSort,
  type OrdenServicioFilters,
  type OrdenServicioListItem,
  type OrdenSort,
} from "@/modules/service-orders/queries";
import { ORDER_STATUS_LABEL } from "@/modules/service-orders/statuses";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { formatDateTime } from "@/shared/datetime";
import { Pagination } from "@/shared/ui/Pagination";
import { BulkResultPanel } from "@/shared/ui/selection/BulkResultPanel";
import { RowActions } from "@/shared/ui/selection/RowActions";
import { RowCheckbox, SelectAllCheckbox } from "@/shared/ui/selection/RowCheckbox";
import { SelectionBar } from "@/shared/ui/selection/SelectionBar";
import { SelectionProvider } from "@/shared/ui/selection/SelectionProvider";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SearchParams = Record<string, string | string[] | undefined>;

const VALID_STATUS = new Set<OrderStatus>(["open", "in_progress", "done", "cancelled"]);

// The parts picker inside ServiceOrderForm still works over an already-
// fetched list (client-side search+cart idiom, no server round-trip),
// capped at 1000 rows — there is no dedicated parts search route yet (known
// sibling limitation, proposal.md's Out of Scope). The customer picker no
// longer preloads anything: `customer-search-and-picker` gave it its own
// `GET /api/customers?search=` route instead (`CustomerPicker.tsx`).
const PICKER_LIST_LIMIT = 1000;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Pure — R21's status filter + D7's search term, read from `searchParams`. */
function normalizeOrdenFilters(searchParams: SearchParams): OrdenServicioFilters {
  const status = firstValue(searchParams.status);
  const search = firstValue(searchParams.search);
  return {
    ...(status && VALID_STATUS.has(status as OrderStatus) ? { status: status as OrderStatus } : {}),
    ...(search ? { search } : {}),
  };
}

/**
 * R20/R21 — paginated, status-filtered service-order list. Mirrors
 * inventory/page.tsx's template (design.md §8): server component,
 * `searchParams`, `Promise.all([list,count])`, filter Card, `Pagination`,
 * empty-state. Staff-only via the blanket `requireSessionFromHeaders()` guard
 * (design.md §7: no new `orders.manage` policy action for v1).
 */
export default async function ServiceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = normalizeOrdenFilters(params);
  const pageSize = parsePageSize(params.pageSize);
  const pageWindow = computePageWindow(params.page, pageSize);
  const sort = parseOrdenSort(params);

  const user = await requireSessionFromHeaders();
  if (!can(user, "service-orders.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const [items, total, products] = await Promise.all([
    listOrdenesServicio(filters, pageWindow, sort),
    countOrdenesServicio(filters),
    listInventory({}, { offset: 0, limit: PICKER_LIST_LIMIT }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  // The props that cross into the client (design D3). Every one is a string, an
  // array of strings, or a `Record<string, string>` — no function, no `Date`,
  // no class instance. `orden.appointmentAt` IS a `Date` and is deliberately
  // not among them.
  const pageIds = items.map((orden) => orden.id);
  const labels = Object.fromEntries(items.map((orden) => [orden.id, `orden ${orden.id}`]));
  // D9's input: the CURRENT statuses the menu intersects over, for this page's
  // rows only. A selection that outlived the page it was made on holds ids that
  // are not in here, and `OrderBulkStatusActions` stands down rather than
  // guessing at them.
  const statuses = Object.fromEntries(items.map((orden) => [orden.id, orden.status]));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className={PAGE_HEADING}>Órdenes de servicio</h1>
        <ServiceOrderFormTrigger
          products={products.items}
          canCreateCustomer={can(user, "customers.write")}
          triggerLabel="Nueva orden de servicio"
        />
      </div>

      <Card size="sm" className="mb-4">
        <CardContent>
          <ServiceOrderFilters selected={filters} pageSize={pageSize} />
        </CardContent>
      </Card>

      {/* The provider wraps BOTH branches below, not just the table: a filter
          that matches nothing renders the empty state instead, and a provider
          living inside the table branch would unmount on that switch — taking
          the selection AND the "se limpió la selección" notice with it, in
          precisely the case the notice exists to explain. */}
      <SelectionProvider pageIds={pageIds} labels={labels} filterKey={buildFilterKey(filters)}>
        <SelectionBar>
          <OrderBulkStatusActions statuses={statuses} />
        </SelectionBar>
        <BulkResultPanel reasons={ORDER_REFUSAL_MESSAGES} />
        {items.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Wrench className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">No se encontraron órdenes</h2>
              <p className="text-sm text-muted-foreground">
                {/* `search` belongs here as much as `status` does. Without it,
                    a term that matches nothing tells the operator there are no
                    orders REGISTERED — a claim, and a false one over a database
                    holding forty. `customers/page.tsx` learned this and wrote
                    it down three lines below its own branch; this is the same
                    class on the sibling screen. */}
                {filters.status || filters.search ? (
                  <>
                    Ninguna orden coincide con el filtro.{" "}
                    <Link href="/service-orders" className="text-primary hover:underline">
                      Limpiar filtro
                    </Link>
                  </>
                ) : (
                  "Todavía no hay órdenes de servicio registradas."
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card size="sm" className="mb-4">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* `w-10` and no label: `table.tsx` already ships
                        `[&:has([role=checkbox])]:pr-0` on `TableHead`, so the
                        column needs no new table primitive. The accessible name
                        lives on the checkbox itself. */}
                    <TableHead className="w-10">
                      <SelectAllCheckbox />
                    </TableHead>
                    {COLUMNS.map((column) =>
                      column.sort ? (
                        <SortableHeader
                          key={column.label}
                          label={column.label}
                          href={buildSortHref(params, column.sort, sort)}
                          dir={sort?.key === column.sort ? sort.dir : undefined}
                        />
                      ) : (
                        <TableHead key={column.label}>{column.label}</TableHead>
                      ),
                    )}
                    <TableHead className="w-24">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((orden) => (
                    <TableRow key={orden.id}>
                      <TableCell>
                        <RowCheckbox id={orden.id} label={`orden ${orden.id}`} />
                      </TableCell>
                      {/* DISPLAY-ONLY truncation (spec's "ID renders truncated") —
                          the stored `id` stays the full UUID; the detail page
                          keeps rendering it in full. */}
                      <TableCell className="font-mono text-xs">{orden.id.slice(0, 8)}</TableCell>
                      <TableCell>{orden.clienteName}</TableCell>
                      <TableCell>{vehiculoLabel(orden)}</TableCell>
                      <TableCell>
                        <StatusBadge status={orden.status} label={ORDER_STATUS_LABEL[orden.status]} />
                      </TableCell>
                      <TableCell>{formatDateTime(orden.appointmentAt)}</TableCell>
                      <TableCell>
                        {/* The `h-7` (28px) hand-copied link that used to live
                            here is deleted, not restyled — it sat under
                            AGENTS.md's 44x44 floor, and the kebab trigger is
                            where that floor now lives. */}
                        <RowActions label={`Acciones de la orden ${orden.id}`}>
                          {/* `render`, not a nested `<Link>`. Measured in jsdom against
                              base-ui 1.6: with the link NESTED inside the item,
                              ArrowDown+Enter fires base-ui's click on the `role="menuitem"`
                              div and it never reaches the anchor — 0 clicks, menu closes, no
                              navigation. With `render` the anchor IS the menuitem and the
                              same keystrokes navigate. "Ver" was keyboard-reachable as a bare
                              link before the kebab existed; it has to stay that way.

                              This does NOT contradict the `buttonVariants` comment on the old
                              row link: that one rejects base-ui's `Button` COMPONENT wrapping
                              an anchor. `DropdownMenuItem`'s `render` is the library's
                              ordinary composition API, a different thing. */}
                          <DropdownMenuItem
                            render={
                              <Link href={`/service-orders/${orden.id}`} className="flex w-full items-center gap-1.5">
                                <Eye aria-hidden="true" />
                                Ver
                              </Link>
                            }
                          />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {pageCount > 1 && (
            <Card size="sm">
              <CardContent>
                <Pagination
                  currentPage={pageWindow.page}
                  pageCount={pageCount}
                  hrefPattern={buildPageHrefPattern(params, sort)}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
      </SelectionProvider>
    </div>
  );
}

/**
 * The bulk panel's refusal vocabulary — injected, never owned by the panel
 * (design D4). Only the codes `PATCH /api/service-orders/[id]` can actually
 * answer with for a `{status}` body are here; an unmapped code renders as the
 * raw code, which a reader can grep for, rather than as a generic sentence that
 * tells them nothing.
 *
 * `invalid_transition` is the drift scenario's whole answer: the menu offered
 * the status because THIS page said the row was `open`, and the row's own
 * request found it somewhere else.
 */
const ORDER_REFUSAL_MESSAGES: Record<string, string> = {
  invalid_transition: "Su estado actual ya no permite ese cambio. Recargá la página.",
  not_found: "Esa orden ya no existe. Recargá la página.",
  Forbidden: "No tenés permiso para cambiar el estado de esta orden.",
  // `runSequential`'s own code for a `fetch` that threw — the only reason
  // reaching the panel that no route produced.
  request_failed: "No se pudo conectar con el servidor. Intentá de nuevo.",
};

/**
 * The canonical serialisation of the ACTIVE FILTERS — and of nothing else.
 *
 * A change to this string clears the operator's whole selection (design D5), so
 * what is in it IS the spec's "Sort and pagination do not clear it" scenario.
 * `sort`, `dir`, `page` and `pageSize` are all absent, and the strongest
 * guarantee of that is the argument: this takes the already-narrowed
 * `OrdenServicioFilters`, which `normalizeOrdenFilters` builds from `status`
 * and `search`. Reading `searchParams` here instead would put every other key
 * one typo away from wiping a selection on every column-header click.
 *
 * `search` goes LAST (D11, mirrors `customers/page.tsx:392-397`): it is free
 * text and can contain anything, `|` included, while `status` is a closed
 * four-value enum that cannot be confused with part of a search term.
 */
function buildFilterKey(filters: OrdenServicioFilters): string {
  return `status=${filters.status ?? "all"}|search=${filters.search ?? ""}`;
}

/**
 * The header row, declared HERE rather than derived from `ORDEN_SORT` — same
 * reasoning as `customers/page.tsx`'s `COLUMNS`: deriving it would let a
 * query-layer whitelist change silently reshape the table with no matching
 * `<TableCell>`. `Cliente` and `Vehículo` have no `sort` on purpose — sorting
 * by customer name or vehicle plate would need a joined `ORDER BY` with
 * `unaccent`/`lower` wrapping, new SQL this change does not add
 * (spec's "Unsorted Default Order Is Appointment-First", out-of-scope note).
 * `Descripción` is GONE (spec's "Order List Columns Show Customer and
 * Vehicle"); `Acciones` never sorts.
 */
const COLUMNS: readonly { label: string; sort?: keyof typeof ORDEN_SORT }[] = [
  { label: "ID", sort: "id" },
  { label: "Cliente" },
  { label: "Vehículo" },
  { label: "Estado", sort: "status" },
  { label: "Cita", sort: "appointmentAt" },
];

/**
 * The `Vehículo` cell identifies the car, not merely its registration (spec's
 * "List shows customer and the car, not just its plate"): the plate AND the
 * make/model the workshop knows it by. `make`/`model` are both nullable, so
 * this degrades to the plate alone with no dangling separator or empty
 * segment when neither is present — the dev database already holds a
 * vehicle shaped exactly like that, which a fixture with both set cannot
 * catch (spec's "A vehicle with no make or model still renders its plate").
 */
function vehiculoLabel(orden: Pick<OrdenServicioListItem, "vehiculoPlate" | "vehiculoMake" | "vehiculoModel">): string {
  const makeModel = [orden.vehiculoMake, orden.vehiculoModel].filter(Boolean).join(" ");
  return makeModel ? `${orden.vehiculoPlate} ${makeModel}` : orden.vehiculoPlate;
}

/**
 * table-column-sorting D1 — a real `<a>`/`<Link>` built by this Server
 * Component, not a `<button>` with a client `onClick`: that would need a new
 * client boundary around the header (the "server function handed to a client
 * component" defect class already documented on the customers page) and a new
 * `router.push` outside `ServiceOrderFilters`' single writer.
 */
function SortableHeader({
  label,
  href,
  dir,
}: {
  label: string;
  href: string;
  dir?: "asc" | "desc";
}) {
  return (
    <TableHead aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
      <Link href={href} className="-mx-2 inline-flex min-h-11 min-w-11 items-center gap-1 px-2 hover:text-foreground">
        {label}
        {dir === "asc" && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
        {dir === "desc" && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      </Link>
    </TableHead>
  );
}

/**
 * Server-Side Full-Result-Set Sort with Page Reset — `page` is dropped
 * entirely (the spec allows either). Clicking the already-active column
 * toggles direction; any other column starts at `asc`.
 */
function buildSortHref(params: SearchParams, key: keyof typeof ORDEN_SORT, currentSort: OrdenSort | undefined): string {
  const query = new URLSearchParams();
  // `firstValue` on all three, not just `search`. `normalizeOrdenFilters`
  // already reads `status` that way, so `?status=open&status=done` FILTERS by
  // `open` while every sort and pagination link dropped status entirely —
  // pre-existing, and exactly the class the comment below names. Fixing one of
  // three would have left the other two lying in the same file.
  const status = firstValue(params.status);
  if (status) query.set("status", status);
  const size = firstValue(params.pageSize);
  if (size) query.set("pageSize", size);
  const term = firstValue(params.search);
  if (term) query.set("search", term);
  const nextDir = currentSort?.key === key && currentSort.dir === "asc" ? "desc" : "asc";
  query.set("sort", key);
  query.set("dir", nextDir);
  return `/service-orders?${query.toString()}`;
}

/**
 * A serializable `{page}` pattern — see the note on the customers page's
 * twin. The sort is one of the filters that has to survive paging: taken from
 * the PARSED sort, never from `params`, so an unrecognised `?sort=` (including
 * an inherited prototype name `parseOrdenSort`'s `Object.hasOwn` rejects)
 * cannot be laundered into the pagination links.
 */
function buildPageHrefPattern(params: SearchParams, sort: OrdenSort | undefined): string {
  const query = new URLSearchParams();
  const status = firstValue(params.status);
  if (status) query.set("status", status);
  const size = firstValue(params.pageSize);
  if (size) query.set("pageSize", size);
  // `firstValue`, matching `normalizeOrdenFilters` — `customers/page.tsx:485-489`'s
  // comment records the bug a `typeof === "string"` check caused once:
  // `?search=a&search=b` reads as an array and drops silently.
  const term = firstValue(params.search);
  if (term) query.set("search", term);
  if (sort) {
    query.set("sort", sort.key);
    query.set("dir", sort.dir);
  }
  const rendered = query.toString();
  return `/service-orders?${rendered ? `${rendered}&` : ""}page={page}`;
}
