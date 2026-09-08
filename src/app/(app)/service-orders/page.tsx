import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, Wrench } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { computePageWindow, listInventory, parsePageSize } from "@/modules/inventory-view/queries";
import { ServiceOrderFilters } from "@/modules/service-orders/ServiceOrderFilters";
import { ServiceOrderFormTrigger } from "@/modules/service-orders/ServiceOrderFormTrigger";
import {
  countOrdenesServicio,
  listOrdenesServicio,
  ORDEN_SORT,
  parseOrdenSort,
  type OrdenServicioFilters,
  type OrdenSort,
} from "@/modules/service-orders/queries";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { formatDateTime } from "@/shared/datetime";
import { Pagination } from "@/shared/ui/Pagination";
import { RowActions } from "@/shared/ui/selection/RowActions";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SearchParams = Record<string, string | string[] | undefined>;

const VALID_STATUS = new Set<OrderStatus>(["open", "in_progress", "done", "cancelled"]);
const STATUS_LABEL: Record<OrderStatus, string> = {
  open: "Abierta",
  in_progress: "En progreso",
  done: "Completada",
  cancelled: "Cancelada",
};

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

/** Pure — R21's status-filter predicate, read from `searchParams`. */
function normalizeOrdenFilters(searchParams: SearchParams): OrdenServicioFilters {
  const status = firstValue(searchParams.status);
  return status && VALID_STATUS.has(status as OrderStatus) ? { status: status as OrderStatus } : {};
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

      {items.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Wrench className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">No se encontraron órdenes</h2>
              <p className="text-sm text-muted-foreground">
                {filters.status ? (
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
                      <TableCell className="font-mono text-xs">{orden.id}</TableCell>
                      <TableCell>
                        <StatusBadge status={orden.status} label={STATUS_LABEL[orden.status]} />
                      </TableCell>
                      <TableCell>{orden.description ?? "—"}</TableCell>
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
    </div>
  );
}

/**
 * The header row, declared HERE rather than derived from `ORDEN_SORT` — same
 * reasoning as `customers/page.tsx`'s `COLUMNS`: deriving it would let a
 * query-layer whitelist change silently reshape the table with no matching
 * `<TableCell>`. `Descripción` has no `sort` on purpose (unindexed free text,
 * no user-meaningful order); `Acciones` never does.
 */
const COLUMNS: readonly { label: string; sort?: keyof typeof ORDEN_SORT }[] = [
  { label: "ID", sort: "id" },
  { label: "Estado", sort: "status" },
  { label: "Descripción" },
  { label: "Cita", sort: "appointmentAt" },
];

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
  const search = new URLSearchParams();
  if (typeof params.status === "string" && params.status) search.set("status", params.status);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  const nextDir = currentSort?.key === key && currentSort.dir === "asc" ? "desc" : "asc";
  search.set("sort", key);
  search.set("dir", nextDir);
  return `/service-orders?${search.toString()}`;
}

/**
 * A serializable `{page}` pattern — see the note on the customers page's
 * twin. The sort is one of the filters that has to survive paging: taken from
 * the PARSED sort, never from `params`, so an unrecognised `?sort=` (including
 * an inherited prototype name `parseOrdenSort`'s `Object.hasOwn` rejects)
 * cannot be laundered into the pagination links.
 */
function buildPageHrefPattern(params: SearchParams, sort: OrdenSort | undefined): string {
  const search = new URLSearchParams();
  if (typeof params.status === "string" && params.status) search.set("status", params.status);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  if (sort) {
    search.set("sort", sort.key);
    search.set("dir", sort.dir);
  }
  const query = search.toString();
  return `/service-orders?${query ? `${query}&` : ""}page={page}`;
}
