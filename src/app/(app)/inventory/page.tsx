import Link from "next/link";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { InventoryFilters } from "@/modules/inventory-view/InventoryFilters";
import { InventoryStatsHeader } from "@/modules/inventory-view/InventoryStatsHeader";
import {
  computePageWindow,
  countAllProducts,
  hasAnyProducts,
  listCategoryL1Options,
  listCategoryL2Options,
  listInventory,
  normalizeFilters,
} from "@/modules/inventory-view/queries";
import { ManualSyncButton } from "@/modules/inventory-sync/ManualSyncButton";
import { CARD, PAGE_HEADING, TABLE_TD, TABLE_TH } from "@/shared/ui/styles";

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
  const pageWindow = computePageWindow(params.page);
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

  if (dbEmpty) {
    return (
      <main className="p-8">
        <InventoryStatsHeader user={user} total={grandTotal} />
        <h1 className={PAGE_HEADING}>Inventory</h1>
        <div className={CARD}>
          <p className="text-sm text-dash-fg">
            The inventory is empty. Ask an administrator to run an inventory sync to populate it.
          </p>
          {canTriggerSync && <ManualSyncButton />}
        </div>
      </main>
    );
  }

  return (
    <main className="p-8">
      <InventoryStatsHeader user={user} total={grandTotal} />
      <h1 className={PAGE_HEADING}>Inventory</h1>
      <div className={CARD}>
        {canTriggerSync && <ManualSyncButton />}
        <InventoryFilters
          categoryL1Options={categoryL1Options}
          categoryL2Options={categoryL2Options}
          selected={filters}
        />
        {items.length === 0 ? (
          <p className="text-sm text-dash-fg">
            No products match the selected filters.{" "}
            <Link href="/inventory" className="text-dash-purple hover:underline">
              Clear filters
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-dash-muted/40">
            <table className="w-full border-collapse">
              <thead className="bg-dash-card">
                <tr>
                  <th className={TABLE_TH}>ID</th>
                  <th className={TABLE_TH}>Name</th>
                  <th className={TABLE_TH}>Category L1</th>
                  <th className={TABLE_TH}>Category L2</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-dash-muted/20">
                    <td className={TABLE_TD}>{item.id}</td>
                    <td className={TABLE_TD}>{item.name}</td>
                    <td className={TABLE_TD}>{item.categoryL1 ?? "—"}</td>
                    <td className={TABLE_TD}>{item.categoryL2 ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav className="mt-4 flex items-center gap-4 text-sm text-dash-fg">
          <span>
            Page {pageWindow.page} of {pageCount}
          </span>
          {pageWindow.page > 1 && (
            <Link href={buildPageHref(params, pageWindow.page - 1)} className="text-dash-purple hover:underline">
              Previous
            </Link>
          )}
          {pageWindow.page < pageCount && (
            <Link href={buildPageHref(params, pageWindow.page + 1)} className="text-dash-purple hover:underline">
              Next
            </Link>
          )}
        </nav>
      </div>
    </main>
  );
}

function buildPageHref(params: SearchParams, page: number): string {
  const search = new URLSearchParams();
  if (typeof params.categoryL1 === "string" && params.categoryL1) search.set("categoryL1", params.categoryL1);
  if (typeof params.categoryL2 === "string" && params.categoryL2) search.set("categoryL2", params.categoryL2);
  search.set("page", String(page));
  return `/inventory?${search.toString()}`;
}
