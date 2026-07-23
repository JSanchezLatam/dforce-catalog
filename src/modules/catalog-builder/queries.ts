/**
 * catalog-builder — DB-touching reads (R5). Reuses `producto` exactly as
 * `inventory-view/queries.ts` does; `listCategoryL1Options` is imported
 * directly from there for the L1 checkbox list rather than duplicated here.
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { producto } from "@/shared/db/schema";

import type { CategoryRef, ProductRef } from "./selection";

export type CategoryPair = { categoryL1: string; categoryL2: string };

/** All known (L1,L2) pairs, for building the L2-exclusion checkboxes per included L1. */
export async function listCategoryPairs(): Promise<CategoryPair[]> {
  const rows = await db
    .selectDistinct({ categoryL1: producto.categoryL1, categoryL2: producto.categoryL2 })
    .from(producto)
    .where(and(isNotNull(producto.categoryL1), isNotNull(producto.categoryL2)));
  return rows
    .filter((r): r is CategoryPair => r.categoryL1 !== null && r.categoryL2 !== null)
    .sort((a, b) => (a.categoryL1 === b.categoryL1 ? a.categoryL2.localeCompare(b.categoryL2) : a.categoryL1.localeCompare(b.categoryL1)));
}

/** R5.1 — candidate products for the currently-included L1/L2 category refs (OR'd). */
export async function listProductsInCategories(categories: CategoryRef[]): Promise<ProductRef[]> {
  if (categories.length === 0) return [];

  const conditions = categories.map((ref) =>
    ref.categoryL2
      ? and(eq(producto.categoryL1, ref.categoryL1), eq(producto.categoryL2, ref.categoryL2))
      : eq(producto.categoryL1, ref.categoryL1),
  );

  return db
    .select({
      id: producto.id,
      name: producto.name,
      categoryL1: producto.categoryL1,
      categoryL2: producto.categoryL2,
      image: sql<string>`trim(nullif(${producto.raw}->'Images'->0->>'src', ''))`,
    })
    .from(producto)
    .where(or(...conditions));
}
