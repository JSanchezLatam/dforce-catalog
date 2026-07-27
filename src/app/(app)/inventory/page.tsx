import Link from "next/link";
import { PackageSearch } from "lucide-react";

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
import { Pagination } from "@/shared/ui/Pagination";
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
  if (!can(user, "inventory.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
  }
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
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <PackageSearch className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">No products found</h2>
              <p className="text-sm text-muted-foreground">
                No products match the selected filters.{" "}
                <Link href="/inventory" className="text-primary hover:underline">
                  Clear filters
                </Link>
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
                <Pagination currentPage={pageWindow.page} pageCount={pageCount} hrefPattern={buildPagePattern(params)} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function buildPagePattern(params: SearchParams): string {
  const search = new URLSearchParams();
  if (typeof params.categoryL1 === "string" && params.categoryL1) search.set("categoryL1", params.categoryL1);
  if (typeof params.categoryL2 === "string" && params.categoryL2) search.set("categoryL2", params.categoryL2);
  if (typeof params.name === "string" && params.name) search.set("name", params.name);
  if (typeof params.id === "string" && params.id) search.set("id", params.id);
  if (typeof params.pageSize === "string" && params.pageSize) search.set("pageSize", params.pageSize);
  if (typeof params.stockStatus === "string" && params.stockStatus) search.set("stockStatus", params.stockStatus);
  return `/inventory?${search.toString()}&page={page}`;
}
