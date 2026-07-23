import Link from "next/link";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { InventoryFilters } from "@/modules/inventory-view/InventoryFilters";
import { InventoryStatsHeader } from "@/modules/inventory-view/InventoryStatsHeader";
import {
  computePageWindow,
  countAllProducts,
  DEFAULT_PAGE_SIZE,
  hasAnyProducts,
  listCategoryL1Options,
  listCategoryL2Options,
  listInventory,
  normalizeFilters,
  parsePageSize,
} from "@/modules/inventory-view/queries";
import { ManualSyncButton } from "@/modules/inventory-sync/ManualSyncButton";
import { PAGE_HEADING } from "@/shared/ui/styles";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * R3/R4 — paginated, filterable inventory view. Any authenticated Usuario may
 * load this; `proxy.ts`'s blanket session guard is the only auth check this
 * page needs (design.md: inventory-view has no admin-only action).
 *
 * Pagination uses plain `<Link>`s: Next.js App Router soft-navigates between
 * `searchParams` variants of the same route (no full document reload),
 * satisfying R4.2/NFR-2 without any client-side fetch code.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = normalizeFilters(params);
  const pageSize = parsePageSize(params.pageSize);
  const pageWindow = computePageWindow(params.page, pageSize);
  const user = await requireSessionFromHeaders();
  const canTriggerSync = can(user, "sync.manual"); // R2 — admin-only manual sync trigger

  const [{ items, total }, categoryL1Options, categoryL2Options, grandTotal] = await Promise.all([
    listInventory(filters, pageWindow),
    listCategoryL1Options(),
    listCategoryL2Options(filters.categoryL1),
    countAllProducts(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  // R4.4: distinguishes "Inventory_DB is empty" from "this filter matched
  // nothing" — only pay for the extra check when the current page is empty.
  const dbEmpty = total === 0 && !(await hasAnyProducts());

  const syncButton = canTriggerSync ? <ManualSyncButton /> : undefined;

  if (dbEmpty) {
    return (
      <div className="p-8">
        <InventoryStatsHeader user={user} total={grandTotal} syncButton={syncButton} />
        <h1 className={PAGE_HEADING}>Inventory</h1>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The inventory is empty. Ask an administrator to run an inventory sync to populate it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <InventoryStatsHeader user={user} total={grandTotal} syncButton={syncButton} />
      <h1 className={PAGE_HEADING}>Inventory</h1>
      <Card size="sm" className="mb-4">
        <CardContent>
          <InventoryFilters
            categoryL1Options={categoryL1Options}
            categoryL2Options={categoryL2Options}
            selected={filters}
            pageSize={pageSize}
          />
        </CardContent>
      </Card>
      {items.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No products match the selected filters.{" "}
              <Link href="/inventory" className="text-primary hover:underline">
                Clear filters
              </Link>
            </p>
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
                    <TableHead>Name</TableHead>
                    <TableHead>Category L1</TableHead>
                    <TableHead>Category L2</TableHead>
                    <TableHead className="w-24">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.id}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.categoryL1 ?? "—"}</TableCell>
                      <TableCell>{item.categoryL2 ?? "—"}</TableCell>
                      <TableCell>
                        <Link
                          href={`/inventory/${item.id}`}
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
                <nav className="flex items-center gap-1 text-sm text-muted-foreground">
                  {pageWindow.page > 1 && (
                    <Link href={buildPageHref(params, pageWindow.page - 1)} className="rounded-lg px-3 py-1.5 text-primary hover:bg-muted transition-colors">
                      Previous
                    </Link>
                  )}
                  {renderPageNumbers(pageWindow.page, pageCount, params)}
                  {pageWindow.page < pageCount && (
                    <Link href={buildPageHref(params, pageWindow.page + 1)} className="rounded-lg px-3 py-1.5 text-primary hover:bg-muted transition-colors">
                      Next
                    </Link>
                  )}
                  <span className="ml-4 text-muted-foreground">
                    Page {pageWindow.page} of {pageCount} ({total} items)
                  </span>
                </nav>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function renderPageNumbers(current: number, total: number, params: SearchParams) {
  const pages: (number | "ellipsis")[] = [];

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (current > 3) pages.push("ellipsis");
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i);
    }
    if (current < total - 2) pages.push("ellipsis");
    pages.push(total);
  }

  return pages.map((p, idx) =>
    p === "ellipsis" ? (
      <span key={`e-${idx}`} className="px-2 text-muted-foreground">…</span>
    ) : (
      <Link
        key={p}
        href={buildPageHref(params, p)}
        className={`rounded-lg px-3 py-1.5 transition-colors ${
          p === current
            ? "bg-primary text-primary-foreground"
            : "text-foreground hover:bg-muted"
        }`}
      >
        {p}
      </Link>
    ),
  );
}

function buildPageHref(params: SearchParams, page: number): string {
  const search = new URLSearchParams();
  if (typeof params.categoryL1 === "string" && params.categoryL1) search.set("categoryL1", params.categoryL1);
  if (typeof params.categoryL2 === "string" && params.categoryL2) search.set("categoryL2", params.categoryL2);
  if (typeof params.name === "string" && params.name) search.set("name", params.name);
  if (typeof params.id === "string" && params.id) search.set("id", params.id);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  if (typeof params.stockStatus === "string" && params.stockStatus) search.set("stockStatus", params.stockStatus);
  search.set("page", String(page));
  return `/inventory?${search.toString()}`;
}
