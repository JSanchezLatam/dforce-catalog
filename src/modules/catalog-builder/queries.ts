/**
 * catalog-builder — DB-touching reads (R5). Reuses `producto` exactly as
 * `inventory-view/queries.ts` does; `listCategoryL1Options` is imported
 * directly from there for the L1 checkbox list rather than duplicated here.
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { producto } from "@/shared/db/schema";

import type { PriceListMap } from "./price-lists";
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
      imageType: sql<"transparent" | "opaque" | "low_res" | null>`${producto.imageType}`,
      // All three tiers in one pass, same read-from-raw approach `image`
      // already uses — no projected column and no migration. Names are
      // trimmed here because Interfuerza's carry trailing whitespace;
      // `resolvePrice` trims again so hand-built maps behave too. Values stay
      // strings, exactly as the ERP sends them, and are parsed in TS where it
      // is testable without a database.
      // TWO guards, because there are two distinct ways one bad row aborts
      // this query for EVERY user — the subquery runs per row, so the blast
      // radius is the whole category listing, not one product.
      //   1. `jsonb_array_elements` RAISES on an object or scalar container.
      //   2. `jsonb_object_agg` RAISES on a NULL key, and `->>'Name'` yields
      //      NULL for any element that is not an object with a string Name.
      //      `->>` does not raise on a non-object, so this one hides until
      //      the aggregate blows up.
      // Verified live against Postgres: `["oops"]` and `[{"Name":null}]` both
      // gave `field name must not be null` before the filter, and a mixed
      // array still yields its good entries after it. A missing key was
      // always safe (an SRF over SQL NULL yields no rows).
      priceLists: sql<PriceListMap | null>`(
        case when jsonb_typeof(${producto.raw}->'PriceLists') = 'array' then (
          select jsonb_object_agg(trim(pl->>'Name'), pl->>'Precio')
                 filter (where jsonb_typeof(pl->'Name') = 'string')
          from jsonb_array_elements(${producto.raw}->'PriceLists') pl
        ) end
      )`,
    })
    .from(producto)
    .where(or(...conditions));
}
