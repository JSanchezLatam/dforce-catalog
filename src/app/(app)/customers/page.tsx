import Link from "next/link";
import { Eye, Users } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { CustomerSyncPanel } from "@/modules/customer-import/CustomerSyncPanel";
import { CustomerFilters } from "@/modules/customers/CustomerFilters";
import { CustomerFormTrigger } from "@/modules/customers/CustomerFormTrigger";
import { countClientes, listClientes, type ClienteFilters } from "@/modules/customers/queries";
import { computePageWindow, parsePageSize } from "@/modules/inventory-view/queries";
import { Pagination } from "@/shared/ui/Pagination";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Pure — R19's single combined name/phone/plate search term, read from `searchParams`. */
function normalizeClienteFilters(searchParams: SearchParams): ClienteFilters {
  const search = firstValue(searchParams.search);
  // R20 — three states, defaulting to active-only. An unknown value falls back
  // to the default rather than throwing: `?status=garbage` from a stale link
  // should show the normal list, not an error page.
  const raw = firstValue(searchParams.status);
  const status = raw === "inactive" || raw === "all" ? raw : "active";
  return { ...(search ? { search } : {}), ...(status === "active" ? {} : { status }) };
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

  // `syncedTotal` is deliberately unfiltered: the stats card answers "how many
  // customers do I have synced", not "how many match what I am looking at".
  // `total` beside it carries the search term and the status filter, so
  // reading the headline off it would make the number move on every keystroke
  // in the search box. Both go in the same `Promise.all` — the extra count is
  // independent of the other two and must not cost a second round trip.
  const [items, total, syncedTotal] = await Promise.all([
    listClientes(filters, pageWindow),
    countClientes(filters),
    countClientes({ status: "all" }),
  ]);

  // Without this a genuinely empty database offered "Ver desactivados" — a
  // link to another empty page — while "Todavía no hay clientes registrados"
  // became reachable only WITH the deactivated ones in view, the one case where it is
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
  // With no search term `filters` is `{}`, so `{...filters, status: "all"}` is
  // the SAME query `syncedTotal` already ran — a third COUNT, and the serial
  // one rather than the parallel one. Reuse the value. The search branch is a
  // genuinely different query (`{search, status: "all"}`) and still needs its
  // own count.
  const hasDeactivated =
    total === 0 && (filters.status ?? "active") === "active"
      ? filters.search
        ? (await countClientes({ ...filters, status: "all" })) > 0
        : syncedTotal > 0
      : false;

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className={`${PAGE_HEADING} mb-1`}>Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Los clientes del taller y sus vehículos. Se sincronizan desde Interfuerza y podés
            editarlos acá.
          </p>
        </div>
        <CustomerFormTrigger triggerLabel="Nuevo cliente" />
      </div>

      {/* The card ALWAYS renders; only the import trigger inside it is gated on
          `customers.write` (R21, the same gate as the create form). The owner
          asked to see how many customers are synced — mounting that number
          inside an action's permission would answer "nowhere" again for any
          future read-only role, and it also made the unfiltered COUNT above
          run for a role that could never see it. A total is data on a page you
          can already read; importing is the privileged part.

          Out of the header row and into its own card because the skip report
          it renders on a partial run is a full-width block, and inside that
          row it stretched it and shoved "Nuevo cliente" out of position. */}
      <CustomerSyncPanel total={syncedTotal} canSync={can(user, "customers.write")} />

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
                {filters.search && (filters.status ?? "active") === "active" && hasDeactivated ? (
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
                      href={buildPageHref({ ...params, status: "all" }, 1)}
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
                ) : (filters.status ?? "active") === "active" && hasDeactivated ? (
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
                    <Link href={buildPageHref({ ...params, status: "inactive" }, 1)} className="text-primary hover:underline">
                      Ver desactivados
                    </Link>
                  </>
                ) : filters.status === "inactive" ? (
                  // The new state brought its own empty case. Without this
                  // branch a "Desactivados" filter over 368 active customers
                  // said "Todavía no hay clientes registrados" — false, and the
                  // same class as the two branches above: an empty state that
                  // claims more than it knows.
                  <>
                    Ningún cliente desactivado.{" "}
                    <Link
                      href={buildPageHref({ ...params, status: "active" }, 1)}
                      className="text-primary hover:underline"
                    >
                      Ver los activos
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
                        {/* `buttonVariants` on a plain `Link`, NOT
                            `<Button render={<Link/>}>`. Measured, both ways:
                            base-ui's Button defaults to `nativeButton: true`
                            and logs "expected a native <button>" to the
                            console on every render when handed an anchor,
                            while `nativeButton={false}` renders
                            `<a href role="button">` — announcing a navigation
                            as a button and dropping it out of the links list.
                            `buttonVariants` is the styling without the
                            behaviour, which is all a link needs. */}
                        <Link
                          href={`/customers/${item.id}`}
                          className={cn(buttonVariants({ variant: "outline", size: "default" }), "min-h-11 min-w-11")}
                        >
                          <Eye aria-hidden="true" />
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

/**
 * A serializable `{page}` PATTERN, not a function.
 *
 * `Pagination` is a client component, and a server component cannot hand one a
 * function — Next.js throws "Functions cannot be passed directly to Client
 * Components". The bug shipped in Phase 6 and stayed invisible for months
 * because `Pagination` returns `null` at `pageCount <= 1`, and this database
 * held one customer. Importing the Interfuerza list made it 37 pages and the
 * page stopped rendering.
 *
 * `hrefPattern` is the variant that already existed for exactly this.
 */
function buildPageHrefPattern(params: SearchParams): string {
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
  const status = firstValue(params.status);
  if (status === "inactive" || status === "all") search.set("status", status);
  // `page` appended raw rather than through `URLSearchParams.set`: that
  // percent-encodes the braces, and `Pagination` replaces the literal `{page}`.
  const query = search.toString();
  return `/customers?${query ? `${query}&` : ""}page={page}`;
}

/**
 * One concrete page, derived from the pattern above rather than built beside
 * it — the two widen-search links use this, and the whole reason the pattern
 * carries every filter is that a second copy dropped `pageSize` once already.
 */
function buildPageHref(params: SearchParams, page: number): string {
  return buildPageHrefPattern(params).replace("{page}", String(page));
}
