import Link from "next/link";
import { Users } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { CustomerFilters } from "@/modules/customers/CustomerFilters";
import { CustomerFormTrigger } from "@/modules/customers/CustomerFormTrigger";
import { countClientes, listClientes, type ClienteFilters } from "@/modules/customers/queries";
import { computePageWindow, parsePageSize } from "@/modules/inventory-view/queries";
import { Pagination } from "@/shared/ui/Pagination";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Pure — R19's single combined name/phone/plate search term, read from `searchParams`. */
function normalizeClienteFilters(searchParams: SearchParams): ClienteFilters {
  const search = firstValue(searchParams.search);
  // R20 — opt IN, so the default list is active-only. `=== "1"` rather than
  // truthiness: `?includeInactive=0` must mean off, not "a non-empty string".
  const includeInactive = firstValue(searchParams.includeInactive) === "1";
  return { ...(search ? { search } : {}), ...(includeInactive ? { includeInactive } : {}) };
}

/**
 * R16/R19 — paginated, searchable customer list. Mirrors inventory/page.tsx's
 * server-component + `searchParams` + `Promise.all([list,count])` + filter
 * Card + `Pagination` + empty-state template (design.md §8). Staff-only via
 * the blanket `requireSessionFromHeaders()` guard — no admin sub-gate
 * (design.md §7: no new `customers.manage` policy action for v1).
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = normalizeClienteFilters(params);
  const pageSize = parsePageSize(params.pageSize);
  const pageWindow = computePageWindow(params.page, pageSize);

  const user = await requireSessionFromHeaders();
  if (!can(user, "customers.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }

  const [items, total] = await Promise.all([listClientes(filters, pageWindow), countClientes(filters)]);

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className={PAGE_HEADING}>Clientes</h1>
        <CustomerFormTrigger triggerLabel="Nuevo cliente" />
      </div>

      <Card size="sm" className="mb-4">
        <CardContent>
          <CustomerFilters selected={filters} pageSize={pageSize} />
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">No se encontraron clientes</h2>
              <p className="text-sm text-muted-foreground">
                {filters.search ? (
                  <>
                    Ningún cliente coincide con la búsqueda.{" "}
                    <Link href="/customers" className="text-primary hover:underline">
                      Limpiar filtro
                    </Link>
                  </>
                ) : (
                  "Todavía no hay clientes registrados."
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
                    <TableHead>Nombre</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Vehículos</TableHead>
                    <TableHead className="w-24">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.name}
                        {item.deactivatedAt && (
                          // NOT `CHIP`: that class marks neutral metadata
                          // (make, model, year), so a retired customer would
                          // read with the same weight as "Toyota".
                          <span className="ml-2 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            Desactivado
                          </span>
                        )}
                      </TableCell>
                      {/* `||`, not `??`. Migration `0016` made `phone` NOT
                          NULL, so "no phone on record" is now `""` — and `??`
                          is NULLISH, so an empty string sailed straight past
                          the fallback and rendered a blank cell while every
                          other column showed an em dash. `email` is still
                          nullable and keeps `??`. */}
                      <TableCell>{item.phone || "—"}</TableCell>
                      <TableCell>{item.email ?? "—"}</TableCell>
                      <TableCell>{item.plates.length > 0 ? item.plates.join(", ") : "—"}</TableCell>
                      <TableCell>
                        <Link
                          href={`/customers/${item.id}`}
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
                  buildHref={(p) => buildPageHref(params, p)}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function buildPageHref(params: SearchParams, page: number): string {
  const search = new URLSearchParams();
  if (typeof params.search === "string" && params.search) search.set("search", params.search);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  // R20 — every filter in the URL has to survive paging. Dropped here, "Ver
  // desactivados" would silently switch itself off on page 2, which reads as
  // the records having disappeared rather than the filter having reset.
  if (firstValue(params.includeInactive) === "1") search.set("includeInactive", "1");
  search.set("page", String(page));
  return `/customers?${search.toString()}`;
}
