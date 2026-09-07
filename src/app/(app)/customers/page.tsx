import Link from "next/link";
import { Users } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { CustomerImportButton } from "@/modules/customer-import/CustomerImportButton";
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

  // Without this a genuinely empty database offered "Ver desactivados" — a
  // link to another empty page — while "Todavía no hay clientes registrados"
  // became reachable only WITH `includeInactive=1`, the one case where it is
  // least true.
  //
  // Cost, stated honestly rather than as "nothing in the normal case": this is
  // a second sequential scan, issued serially, and it runs on EVERY empty
  // result — which on this screen includes every mistyped search, not only the
  // empty-database case it exists for. Acceptable because it runs only when
  // the first count already returned zero, i.e. when there is nothing to
  // render and no list query competing with it.
  //
  // `total`, not `items.length`: an empty PAGE is not an empty RESULT SET
  // (`api/customers/route.ts` documents the same distinction). Past the last
  // page of a search that does match, the result set is not empty and no offer
  // belongs on screen.
  const hasDeactivated =
    total === 0 && !filters.includeInactive
      ? (await countClientes({ ...filters, includeInactive: true })) > 0
      : false;

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className={PAGE_HEADING}>Clientes</h1>
        <div className="flex items-center gap-2">
          {/* R21 — manual import trigger, same `customers.write` gate as the create form (both tecnico and administrador hold it). */}
          {can(user, "customers.write") && <CustomerImportButton />}
          <CustomerFormTrigger triggerLabel="Nuevo cliente" />
        </div>
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
                {filters.search && !filters.includeInactive && hasDeactivated ? (
                  // R20 — searching a name is how staff actually reach ONE
                  // customer, far more than opening a bare list. Without this
                  // branch, searching a deactivated customer said they did not
                  // match and offered only a link that clears the search: the
                  // record is one query-string key away and nothing said so.
                  // The term is preserved, or the offer costs the search.
                  <>
                    Ningún cliente activo coincide con la búsqueda.{" "}
                    <Link
                      // Through `buildPageHref` so this link cannot drift from
                      // the pagination links beside it — it kept `pageSize`
                      // and this one had dropped it.
                      href={buildPageHref({ ...params, includeInactive: "1" }, 1)}
                      className="text-primary hover:underline"
                    >
                      Buscar también entre los desactivados
                    </Link>
                  </>
                ) : filters.search ? (
                  <>
                    Ningún cliente coincide con la búsqueda.{" "}
                    <Link href="/customers" className="text-primary hover:underline">
                      Limpiar filtro
                    </Link>
                  </>
                ) : !filters.includeInactive && hasDeactivated ? (
                  // R20 — "no hay clientes" is a claim, and it is false when
                  // every customer is deactivated. The rest of this change is
                  // careful never to let a retired record be silently
                  // invisible (the chip, the banner); an empty screen that
                  // hides them is the same failure with no surface to point at.
                  <>
                    No hay clientes activos.{" "}
                    {/* Through `buildPageHref`, like the widen-search link
                        above — hardcoded, this one dropped `pageSize`, which
                        is the defect WU14.2 fixed one branch over. */}
                    <Link href={buildPageHref({ ...params, includeInactive: "1" }, 1)} className="text-primary hover:underline">
                      Ver desactivados
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
  // `firstValue` for every key, matching `normalizeClienteFilters`. The
  // `typeof === "string"` checks these replace saw `?search=a&search=b` as an
  // array and dropped it, so the page filtered by "a" while page 2's link
  // carried no search at all — the same shape of bug one line below.
  const term = firstValue(params.search);
  const size = firstValue(params.pageSize);
  if (term) search.set("search", term);
  if (size) search.set("pageSize", size);
  // R20 — every filter in the URL has to survive paging. Dropped here, "Ver
  // desactivados" would silently switch itself off on page 2, which reads as
  // the records having disappeared rather than the filter having reset.
  if (firstValue(params.includeInactive) === "1") search.set("includeInactive", "1");
  search.set("page", String(page));
  return `/customers?${search.toString()}`;
}
