import Link from "next/link";

import { InventoryFilters } from "@/modules/inventory-view/InventoryFilters";
import {
  computePageWindow,
  hasAnyProducts,
  listCategoryL1Options,
  listCategoryL2Options,
  listInventory,
  normalizeFilters,
} from "@/modules/inventory-view/queries";

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

  const [{ items, total }, categoryL1Options, categoryL2Options] = await Promise.all([
    listInventory(filters, pageWindow),
    listCategoryL1Options(),
    listCategoryL2Options(filters.categoryL1),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageWindow.limit));

  // R4.4: distinguishes "Inventory_DB is empty" from "this filter matched
  // nothing" — only pay for the extra check when the current page is empty.
  const dbEmpty = total === 0 && !(await hasAnyProducts());

  if (dbEmpty) {
    return (
      <main>
        <h1>Inventory</h1>
        <p>The inventory is empty. Ask an administrator to run an inventory sync to populate it.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Inventory</h1>
      <InventoryFilters
        categoryL1Options={categoryL1Options}
        categoryL2Options={categoryL2Options}
        selected={filters}
      />
      {items.length === 0 ? (
        <p>
          No products match the selected filters. <Link href="/inventory">Clear filters</Link>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Category L1</th>
              <th>Category L2</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.name}</td>
                <td>{item.categoryL1 ?? "—"}</td>
                <td>{item.categoryL2 ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav>
        <span>
          Page {pageWindow.page} of {pageCount}
        </span>
        {pageWindow.page > 1 && <Link href={buildPageHref(params, pageWindow.page - 1)}>Previous</Link>}
        {pageWindow.page < pageCount && <Link href={buildPageHref(params, pageWindow.page + 1)}>Next</Link>}
      </nav>
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
