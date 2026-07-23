/**
 * inventory-view — filtered + paginated read model (R3, R4, NFR-2).
 *
 * Any authenticated Usuario may read this (design.md: no role gate here —
 * `proxy.ts`'s blanket session guard is the only auth check this capability
 * needs, unlike `sync.manual`/`template.edit`/`catalogs.listAll` in policy.ts).
 */
import { and, asc, count, eq, gt, ilike, isNotNull, isNull, or } from "drizzle-orm";

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

/** R3 filter + R4 paginated read. Two DB round-trips (page + total count). */
export async function listInventory(
  filters: InventoryFilters,
  window: { offset: number; limit: number },
): Promise<Omit<InventoryPage, "page" | "pageCount">> {
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
      .orderBy(asc(producto.name))
      .limit(window.limit)
      .offset(window.offset),
    db.select({ value: count() }).from(producto).where(where),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
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
