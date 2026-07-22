import { NextResponse, type NextRequest } from "next/server";

import { listProductsInCategories } from "@/modules/catalog-builder/queries";
import type { CategoryRef } from "@/modules/catalog-builder/selection";

/**
 * R5.1/5.5 — candidate products for the builder's current L1/L2 selection.
 * Any authenticated user may build a catalog (design.md: catalog-builder is
 * not in the admin-only `can()` action list) — `proxy.ts`'s blanket session
 * guard is the only auth check this route needs, same as inventory-view's
 * page not calling `requireSession()` either.
 */
function isCategoryRef(value: unknown): value is CategoryRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Partial<CategoryRef>;
  return typeof ref.categoryL1 === "string" && (ref.categoryL2 == null || typeof ref.categoryL2 === "string");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const categories: CategoryRef[] = Array.isArray(body?.categories) ? body.categories.filter(isCategoryRef) : [];

  const products = categories.length > 0 ? await listProductsInCategories(categories) : [];
  return NextResponse.json({ products });
}
