import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { listProductsByIds, listProductsInCategories } from "@/modules/catalog-builder/queries";
import type { CategoryRef } from "@/modules/catalog-builder/selection";

function isCategoryRef(value: unknown): value is CategoryRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Partial<CategoryRef>;
  return typeof ref.categoryL1 === "string" && (ref.categoryL2 == null || typeof ref.categoryL2 === "string");
}

export async function POST(request: NextRequest) {
  const user = requireSession(request);
  if (!can(user, "catalogs.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const categories: CategoryRef[] = Array.isArray(body?.categories) ? body.categories.filter(isCategoryRef) : [];
  // D10 — the second selection mode. The ids come out of a URL the operator
  // can hand-edit, so anything that is not a string is dropped here rather
  // than handed to `inArray`; the 200 cap is `productsByIdsQuery`'s, applied
  // at the database so a direct POST meets it too.
  const productIds: string[] = Array.isArray(body?.productIds)
    ? body.productIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  const products =
    productIds.length > 0
      ? await listProductsByIds(productIds)
      : categories.length > 0
        ? await listProductsInCategories(categories)
        : [];
  return NextResponse.json({ products });
}
