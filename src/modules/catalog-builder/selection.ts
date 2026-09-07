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
import { PRICE_TIER_ORDER, type PriceTier } from "@/shared/template/price-tiers";
import type { PriceListMap } from "./price-lists";

export type CategoryRef = { categoryL1: string; categoryL2?: string | null };

export type ProductRef = {
  id: string;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  image?: string | null;
  imageType?: "transparent" | "opaque" | "low_res" | null;
  /**
   * All three ERP price tiers, unparsed. The builder holds every tier so the
   * generate-step checkbox group can switch between them without a refetch.
   * All three ALSO travel into the print payload: the tier choice is a render
   * instruction, so the same catalog can be reprinted against a different pair
   * without re-reading the ERP. (This paragraph used to say the opposite —
   * "only the ONE chosen price is resolved into the print payload" — which was
   * the retired single-select's contract. It survived that control's removal
   * by two changes.)
   */
  priceLists?: PriceListMap | null;
};

export const MIN_PRODUCTS_PER_PAGE = 1;
export const MAX_PRODUCTS_PER_PAGE = 20; // R5.4
/**
 * Where the form starts — a preference, and now only a ceiling.
 *
 * This used to have to match what physically fits: WU4's three-row price
 * table (Venta/Taller/Socio) made cards tall enough that the old default of
 * 10 spilled one logical section across two physical pages, and
 * `chunkProducts` split by a fixed count without ever measuring height.
 * `pdf-generation/worker.ts` measures the real card heights in its browser
 * now and `chunkProducts` packs against them, so the page height binds
 * whatever the user picks and this number can no longer overflow a page.
 */
export const DEFAULT_PRODUCTS_PER_PAGE = 6;
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

export type ImageTypeOverride = "transparent" | "opaque" | "low_res" | null;

export type BulkFrameState = {
  /** Per-product image-type overrides currently in effect. */
  overrides: Record<string, ImageTypeOverride>;
  bulkFramed: boolean;
  /** The overrides as they were the moment bulk framing was switched ON. */
  snapshot: Record<string, ImageTypeOverride>;
};

/**
 * The "Enmarcar todos" toggle, as a pure transition.
 *
 * It lives here and not in `ProductLayoutTuner.tsx` because that component is
 * presentational — it owns none of this state, so no test mounted against it
 * could ever have covered the rule that matters. `CatalogBuilderForm.tsx`
 * holds the three values and calls this.
 *
 * Switching ON forces every product opaque, but first snapshots whatever the
 * user had chosen by hand. Switching OFF restores that snapshot verbatim.
 * The original one-way version skipped the snapshot and silently discarded
 * every per-product choice the moment the toggle came back off.
 */
export function toggleBulkFrame(state: BulkFrameState, products: ProductRef[]): BulkFrameState {
  if (state.bulkFramed) {
    return { overrides: { ...state.snapshot }, bulkFramed: false, snapshot: {} };
  }

  return {
    overrides: Object.fromEntries(products.map((product) => [product.id, "opaque" as const])),
    bulkFramed: true,
    snapshot: { ...state.overrides },
  };
}

/** R13 — a catalog prints one or two of the three ERP price lists. */
export const MIN_PRICE_TIERS = 1;
export const MAX_PRICE_TIERS = 2;

export type CatalogSelectionCheck = {
  includedCategoryCount: number;
  totalProductCount: number;
  productsPerPage: number;
  /**
   * Omitted is legitimate, not lax: a job enqueued before tier selection
   * existed carries no `tiers`, and this same function re-validates those
   * payloads server-side. `CatalogTemplate` owns that default
   * (`DEFAULT_PRICE_TIERS`) — the rule here only governs an explicit choice.
   */
  tiers?: readonly PriceTier[];
};

/** R5.4/5.7/5.8-9 — throws with ALL field errors collected (same convention as `validateTemplateConfigInput`). */
export function validateCatalogSelection(check: CatalogSelectionCheck): void {
  const errors: Record<string, string> = {};

  if (check.includedCategoryCount === 0) {
    errors.categories = "Elegí al menos una categoría"; // R5.7
  }

  if (check.totalProductCount === 0) {
    errors.total = "No seleccionaste ningún producto"; // R13 scenario 3
  }

  if (check.totalProductCount > MAX_TOTAL_PRODUCTS) {
    errors.total = `Seleccionaste ${check.totalProductCount}, el máximo es ${MAX_TOTAL_PRODUCTS}`; // R5.8/5.9
  }

  if (
    !Number.isInteger(check.productsPerPage) ||
    check.productsPerPage < MIN_PRODUCTS_PER_PAGE ||
    check.productsPerPage > MAX_PRODUCTS_PER_PAGE
  ) {
    errors.productsPerPage = `Tiene que ser un número entero entre ${MIN_PRODUCTS_PER_PAGE} y ${MAX_PRODUCTS_PER_PAGE}`; // R5.4
  }

  if (check.tiers !== undefined) {
    const unknown = check.tiers.filter((tier) => !PRICE_TIER_ORDER.includes(tier));
    if (unknown.length > 0) {
      // Dropping it silently would print a one-row catalog for a request that
      // asked for two, with nothing anywhere saying why.
      errors.tiers = `Lista de precios desconocida: ${unknown.join(", ")}`;
    } else if (new Set(check.tiers).size !== check.tiers.length) {
      // Two boxes ticked, one row printed — the renderer dedupes, so without
      // this the count check below would pass on a selection of one.
      errors.tiers = "No repitas la misma lista de precios";
    } else if (check.tiers.length < MIN_PRICE_TIERS || check.tiers.length > MAX_PRICE_TIERS) {
      errors.tiers = `Elegí ${MIN_PRICE_TIERS} o ${MAX_PRICE_TIERS} listas de precios`;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new CatalogSelectionValidationError(errors);
  }
}
