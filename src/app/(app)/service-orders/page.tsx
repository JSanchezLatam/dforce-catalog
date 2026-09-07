import Link from "next/link";
import { Wrench } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { computePageWindow, listInventory, parsePageSize } from "@/modules/inventory-view/queries";
import { ServiceOrderFilters } from "@/modules/service-orders/ServiceOrderFilters";
import { ServiceOrderFormTrigger } from "@/modules/service-orders/ServiceOrderFormTrigger";
import { countOrdenesServicio, listOrdenesServicio, type OrdenServicioFilters } from "@/modules/service-orders/queries";
import type { OrderStatus } from "@/modules/service-orders/transitions";
import { formatDateTime } from "@/shared/datetime";
import { Pagination } from "@/shared/ui/Pagination";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
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

  const user = await requireSessionFromHeaders();
  if (!can(user, "service-orders.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const [items, total, products] = await Promise.all([
    listOrdenesServicio(filters, pageWindow),
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
                    <TableHead>ID</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Cita</TableHead>
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
                        <Link
                          href={`/service-orders/${orden.id}`}
                          className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
                        >
                          Ver
                        </Link>
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
                  hrefPattern={buildPageHrefPattern(params)}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** A serializable `{page}` pattern — see the note on the customers page's twin. */
function buildPageHrefPattern(params: SearchParams): string {
  const search = new URLSearchParams();
  if (typeof params.status === "string" && params.status) search.set("status", params.status);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  const query = search.toString();
  return `/service-orders?${query ? `${query}&` : ""}page={page}`;
}
