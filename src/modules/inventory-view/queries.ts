/**
 * inventory-view — filtered + paginated read model (R3, R4, NFR-2).
 *
 * Any authenticated Usuario may read this (design.md: no role gate here —
 * `proxy.ts`'s blanket session guard is the only auth check this capability
 * needs, unlike `sync.manual`/`template.edit`/`catalogs.listAll` in policy.ts).
 */
import { and, asc, count, eq, gt, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { producto } from "@/shared/db/schema";

export const DEFAULT_PAGE_SIZE = 10;

export type InventoryFilters = {
  categoryL1?: string;
  categoryL2?: string;
  name?: string;
  id?: string;
  stockStatus?: "in-stock" | "out-of-stock";
};

export type InventoryListItem = {
  id: string;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  price: number | null;
  stock: number | null;
};

export type InventoryPage = {
  items: InventoryListItem[];
  total: number;
  page: number;
  pageCount: number;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Pure — no DB access — reads Next.js's `searchParams` shape (R3.1/3.2). */
const VALID_STOCK = new Set(["in-stock", "out-of-stock"]);

export function normalizeFilters(searchParams: Record<string, string | string[] | undefined>): InventoryFilters {
  const filters: InventoryFilters = {};
  const l1 = firstValue(searchParams.categoryL1);
  const l2 = firstValue(searchParams.categoryL2);
  const n = firstValue(searchParams.name);
  const i = firstValue(searchParams.id);
  const s = firstValue(searchParams.stockStatus);
  if (l1) filters.categoryL1 = l1;
  if (l2) filters.categoryL2 = l2;
  if (n) filters.name = n;
  if (i) filters.id = i;
  if (s && VALID_STOCK.has(s)) filters.stockStatus = s as "in-stock" | "out-of-stock";
  return filters;
}

export function parsePageSize(pageSizeParam: string | string[] | undefined): number {
  const raw = Number(firstValue(pageSizeParam));
  const valid = [10, 25, 50, 100];
  return Number.isFinite(raw) && valid.includes(raw) ? raw : DEFAULT_PAGE_SIZE;
}

/** Pure — no DB access — clamps to a valid 1-based page (R4.1-3). */
export function computePageWindow(
  pageParam: string | string[] | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { page: number; offset: number; limit: number } {
  const raw = Number(firstValue(pageParam));
  const page = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  return { page, offset: (page - 1) * pageSize, limit: pageSize };
}

/**
 * table-column-sorting WU2 — the sortable-column whitelist, mirroring
 * `CLIENTE_SORT` (`customers/queries.ts`). Sortable columns are the RENDERED
 * ones: `id`/`name`/`categoryL1`/`categoryL2` (`inventory/page.tsx:118-121`).
 * `stock`/`price` are fetched and filterable but have no header, so they are
 * NOT here even though they are on `InventoryListItem`.
 *
 * `name` is wrapped in `lower(unaccent(...))` — measured against the app's
 * own database (`:5433`, 699 products): 20 rows have lowercase characters and
 * several carry accents ("FULL SINTÉTICO", "INSTALACIÓN", "Correa honda CRV
 * 06-11 (única) BANDO"), so a plain `ORDER BY` sorts by byte value exactly
 * like WU1's `cliente.name` finding.
 *
 * `id` and `categoryL1`/`categoryL2` are left bare. `id` is a fixed-format
 * code (`PS0000001`), uppercase alphanumeric only — verified, no accented or
 * lowercase id exists. `categoryL1`/`categoryL2` are a small fixed vocabulary
 * synced from Interfuerza (9 and 12 distinct values respectively) — verified,
 * every distinct value is uppercase ASCII with no diacritics.
 */
export const INVENTORY_SORT = {
  id: producto.id,
  name: sql`lower(unaccent(${producto.name}))`,
  categoryL1: producto.categoryL1,
  categoryL2: producto.categoryL2,
} as const;

export type InventorySort = { key: keyof typeof INVENTORY_SORT; dir: "asc" | "desc" };

/**
 * Pure — whitelist + `asc|desc` check; anything else falls back to
 * `undefined`. `Object.hasOwn`, NOT `key in INVENTORY_SORT` — see
 * `parseClienteSort`'s comment (`customers/queries.ts`) for why `in` is
 * unsafe: it walks the prototype chain and lets inherited names like
 * `toString`/`constructor`/`__proto__` through silently.
 */
export function parseInventorySort(
  searchParams: Record<string, string | string[] | undefined>,
): InventorySort | undefined {
  const key = firstValue(searchParams.sort);
  const dir = firstValue(searchParams.dir);
  if (!key || !Object.hasOwn(INVENTORY_SORT, key)) return undefined;
  if (dir !== "asc" && dir !== "desc") return undefined;
  return { key: key as keyof typeof INVENTORY_SORT, dir };
}

/**
 * Always TWO order expressions. `producto.id` is the actual PRIMARY KEY, not
 * merely near-unique like WU1's `createdAt` tiebreaker, so it can never tie —
 * paging can never repeat or skip a row regardless of which column is the
 * primary sort.
 *
 * `NULLS LAST` in both directions, applied uniformly to every column
 * (harmless where the column is `NOT NULL`, like `id`/`name`). It matters
 * most for `categoryL1`/`categoryL2`, which ARE nullable: measured against
 * real data, 36 of 699 products have no `categoryL1` and 601 of 699 — 86% —
 * have no `categoryL2`. Postgres's default null ordering treats NULL as
 * larger than any value, so an unmodified DESC sort by `categoryL2` would
 * open on 601 em-dashes before a single real category appeared — the same
 * failure class as WU1's nullable `email` column, at a far worse ratio.
 *
 * `nulls last` goes AFTER the direction (`asc nulls last`, not inside the
 * column expression) — see `buildClienteOrderBy`'s comment for why: Drizzle's
 * `asc()`/`desc()` append the direction after the expression, so "nulls last"
 * inside it renders "… nulls last desc", which Postgres rejects.
 */
export function buildInventoryOrderBy(sort?: InventorySort) {
  const tiebreak = asc(producto.id);
  // The default is `name` ascending THROUGH THE SAME EXPRESSION as a click on
  // the Name header, not the bare `asc(producto.name)` this function replaced.
  // Measured on the app's own database: bare byte order and
  // `lower(unaccent(...))` order disagree on essentially every one of the 699
  // rows, so keeping the old bare default would make the landing page and
  // "Name ascending" two different orders while the header arrow claimed they
  // were the same.
  if (!sort) return [sql`${INVENTORY_SORT.name} asc nulls last`, tiebreak];
  const column = INVENTORY_SORT[sort.key];
  const primary = sort.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  return [primary, tiebreak];
}

function buildWhere(filters: InventoryFilters) {
  const conditions = [];
  if (filters.categoryL1) conditions.push(eq(producto.categoryL1, filters.categoryL1));
  if (filters.categoryL2) conditions.push(eq(producto.categoryL2, filters.categoryL2));
  if (filters.name) conditions.push(ilike(producto.name, `%${filters.name}%`));
  if (filters.id) conditions.push(ilike(producto.id, `%${filters.id}%`));
  if (filters.stockStatus === "in-stock") conditions.push(gt(producto.stock, 0));
  if (filters.stockStatus === "out-of-stock") conditions.push(or(eq(producto.stock, 0), isNull(producto.stock)));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * R3 filter + R4 paginated read; sortable per table-column-sorting D2. Two DB
 * round-trips (page + total count).
 *
 * `sort` is positional BEFORE `queryFn` — mirroring `listClientes`
 * (`customers/queries.ts`) — so the two existing callers that only ever pass
 * `(filters, window)` (`service-orders/page.tsx`'s picker query, the e2e
 * suite) still COMPILE unchanged. Their ORDER BY does change, deliberately:
 * `buildInventoryOrderBy(undefined)` now sorts by `lower(unaccent(name))`
 * rather than the bare `asc(producto.name)` it replaced, which moves 679 of
 * the 699 real rows. That is the point (see `buildInventoryOrderBy`), and it
 * is safe for the picker: `PICKER_LIST_LIMIT` is 1000, above the row count,
 * so the picker's SET is identical and only its display order changes.
 *
 * The injected-`queryFn` seam is new in this unit: unlike `listClientes`/
 * `listOrdenesServicio`, this function had no override hook before WU2, so it
 * always hit the real DB and could not be unit-tested at all.
 */
export async function listInventory(
  filters: InventoryFilters,
  window: { offset: number; limit: number },
  sort?: InventorySort,
  queryFn: () => Promise<Omit<InventoryPage, "page" | "pageCount">> = async () => {
    const where = buildWhere(filters);

    const [items, totalRows] = await Promise.all([
      db
        .select({
          id: producto.id,
          name: producto.name,
          categoryL1: producto.categoryL1,
          categoryL2: producto.categoryL2,
          price: producto.price,
          stock: producto.stock,
        })
        .from(producto)
        .where(where)
        .orderBy(...buildInventoryOrderBy(sort))
        .limit(window.limit)
        .offset(window.offset),
      db.select({ value: count() }).from(producto).where(where),
    ]);

    return { items, total: totalRows[0]?.value ?? 0 };
  },
): Promise<Omit<InventoryPage, "page" | "pageCount">> {
  return queryFn();
}

/** R4.4 — distinguishes "Inventory_DB is empty" from "filters matched nothing". */
export async function hasAnyProducts(): Promise<boolean> {
  const rows = await db.select({ id: producto.id }).from(producto).limit(1);
  return rows.length > 0;
}

/**
 * PR10 — grand total product count, unfiltered. `listInventory()`'s own
 * `total` is scoped to the active filter (correct for pagination math), which
 * would make the stat header's "TOTAL DE PRODUCTOS" card lie whenever a
 * filter is active — this is the one genuinely missing lightweight count.
 */
export async function countAllProducts(): Promise<number> {
  const rows = await db.select({ value: count() }).from(producto);
  return rows[0]?.value ?? 0;
}

/** Fetch a single product by ID with full raw payload (includes Images, PriceLists, etc.). */
export async function getProductById(id: string) {
  const row = await db.select().from(producto).where(eq(producto.id, id)).limit(1);
  return row[0] ?? null;
}

/** Options for the L1 filter select — distinct, non-null, alphabetical. */
export async function listCategoryL1Options(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: producto.categoryL1 })
    .from(producto)
    .where(isNotNull(producto.categoryL1))
    .orderBy(asc(producto.categoryL1));
  return rows.map((r) => r.value).filter((v): v is string => v !== null && v !== "");
}

/** Options for the L2 filter select, optionally narrowed by the selected L1 (R3.1/3.2). */
export async function listCategoryL2Options(categoryL1?: string): Promise<string[]> {
  const conditions = [isNotNull(producto.categoryL2)];
  if (categoryL1) conditions.push(eq(producto.categoryL1, categoryL1));
  const rows = await db
    .selectDistinct({ value: producto.categoryL2 })
    .from(producto)
    .where(and(...conditions))
    .orderBy(asc(producto.categoryL2));
  return rows.map((r) => r.value).filter((v): v is string => v !== null && v !== "");
}
