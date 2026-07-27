import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { listProductsInCategories } from "@/modules/catalog-builder/queries";
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

  const products = categories.length > 0 ? await listProductsInCategories(categories) : [];
  return NextResponse.json({ products });
}
