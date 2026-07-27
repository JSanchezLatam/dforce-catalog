/**
 * catalog-builder — selection/exclusion logic + validation (R5).
 *
 * Pure, DB-free functions only — the DB-touching candidate-product lookup
 * lives in `queries.ts`. Keeping this module pure is what makes the 200-cap
 * (R5.8/5.9) and category/product exclusion (R5.2/5.3) rules unit-testable
 * without a live Postgres connection, same convention as
 * `inventory-view/queries.ts`'s `normalizeFilters`/`computePageWindow` and
 * `template-config/service.ts`'s `validateTemplateConfigInput`.
 */
import type { CatalogIndexSection } from "@/shared/template/CatalogTemplate";

export type CategoryRef = { categoryL1: string; categoryL2?: string | null };

export type ProductRef = {
  id: string;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  image?: string | null;
  imageType?: "transparent" | "opaque" | "low_res" | null;
};

export const MIN_PRODUCTS_PER_PAGE = 1;
export const MAX_PRODUCTS_PER_PAGE = 20; // R5.4
export const MAX_TOTAL_PRODUCTS = 200; // R5.8/5.9

export class CatalogSelectionValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid catalog selection");
  }
}

function matchesCategoryRef(product: ProductRef, ref: CategoryRef): boolean {
  return product.categoryL1 === ref.categoryL1 && (ref.categoryL2 == null || ref.categoryL2 === product.categoryL2);
}

/** R5.1 — a product is a candidate if it matches ANY selected L1/L2 ref. */
export function matchesAnyCategory(product: ProductRef, refs: CategoryRef[]): boolean {
  return refs.some((ref) => matchesCategoryRef(product, ref));
}

/**
 * R5.2/5.3 — subtracts explicitly excluded L2 subcategories and/or specific
 * products from a candidate set, even though their parent L1 stays included.
 */
export function applySelection(
  candidates: ProductRef[],
  excludedCategories: CategoryRef[],
  excludedProductIds: string[],
): ProductRef[] {
  const excludedIds = new Set(excludedProductIds);
  return candidates.filter(
    (product) => !excludedIds.has(product.id) && !matchesAnyCategory(product, excludedCategories),
  );
}

/** R5.5/5.6 — groups the final (post-exclusion) set for the live index preview. */
export function buildIndexSections(products: ProductRef[]): CatalogIndexSection[] {
  const counts = new Map<string, CatalogIndexSection>();
  for (const product of products) {
    if (!product.categoryL1) continue;
    const key = `${product.categoryL1}::${product.categoryL2 ?? ""}`;
    const existing = counts.get(key);
    if (existing) {
      existing.productCount += 1;
    } else {
      counts.set(key, { categoryL1: product.categoryL1, categoryL2: product.categoryL2, productCount: 1 });
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.categoryL1 === b.categoryL1 ? (a.categoryL2 ?? "").localeCompare(b.categoryL2 ?? "") : a.categoryL1.localeCompare(b.categoryL1),
  );
}

/** R5.5 — auto-derived from the current selection so the title updates live, with no free-text field to keep in sync. */
export function deriveCatalogTitle(includedCategoryL1Names: string[]): string {
  return includedCategoryL1Names.length > 0 ? `Catalog: ${includedCategoryL1Names.join(", ")}` : "Catalog";
}

export type CatalogSelectionCheck = {
  includedCategoryCount: number;
  totalProductCount: number;
  productsPerPage: number;
};

/** R5.4/5.7/5.8-9 — throws with ALL field errors collected (same convention as `validateTemplateConfigInput`). */
export function validateCatalogSelection(check: CatalogSelectionCheck): void {
  const errors: Record<string, string> = {};

  if (check.includedCategoryCount === 0) {
    errors.categories = "Select at least one category"; // R5.7
  }

  if (check.totalProductCount === 0) {
    errors.total = "No products selected"; // R13 scenario 3
  }

  if (check.totalProductCount > MAX_TOTAL_PRODUCTS) {
    errors.total = `${check.totalProductCount} selected, max ${MAX_TOTAL_PRODUCTS}`; // R5.8/5.9
  }

  if (
    !Number.isInteger(check.productsPerPage) ||
    check.productsPerPage < MIN_PRODUCTS_PER_PAGE ||
    check.productsPerPage > MAX_PRODUCTS_PER_PAGE
  ) {
    errors.productsPerPage = `Must be an integer between ${MIN_PRODUCTS_PER_PAGE} and ${MAX_PRODUCTS_PER_PAGE}`; // R5.4
  }

  if (Object.keys(errors).length > 0) {
    throw new CatalogSelectionValidationError(errors);
  }
}
