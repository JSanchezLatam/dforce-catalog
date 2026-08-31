/**
 * The price-tier vocabulary, in its own module rather than in
 * `CatalogTemplate.tsx` where `ProductPrices` lives — deliberately.
 *
 * `registry-types.ts` documents the existing type-only cycle
 * `CatalogTemplate → registry → registry-types → CatalogTemplate` and warns
 * that it survives only while nothing along that path needs a RUNTIME value
 * from `CatalogTemplate.tsx`. `AdaptiveCards` is on that path (via
 * `templates/dforce-classic.tsx`), and it needs the order array at runtime, so
 * putting these here is what keeps that cycle erased at compile time.
 *
 * The `ProductPrices` import below is type-only and therefore erased, so this
 * module adds no runtime edge of its own.
 */
import type { ProductPrices } from "./CatalogTemplate";

/** One of the three ERP price lists, by the name the payload uses. */
export type PriceTier = keyof ProductPrices;

/**
 * Canonical print order — retail, trade, member. The checkbox group that picks
 * tiers cannot impose a meaningful order (ticking Socio first does not mean
 * "print Socio first"), and a printed page that shuffles its price rows
 * between catalogs is a defect, so the order is fixed here and every renderer
 * filters this list rather than mapping the caller's array.
 */
export const PRICE_TIER_ORDER: readonly PriceTier[] = ["venta", "taller", "socio"];

/**
 * What a catalog prints when its payload names no tiers at all. Exists for one
 * reason: jobs enqueued before tier selection existed carry no `tiers` field,
 * and a worker that throws on them turns a queued catalog into a dead job. The
 * default is resolved ONCE, at the top of the render in `CatalogTemplate`;
 * below that point `tiers` is required and never re-defaulted, so a card
 * cannot quietly invent its own row set the way it could if every level had a
 * fallback of its own.
 */
export const DEFAULT_PRICE_TIERS: readonly PriceTier[] = ["venta", "taller"];

/**
 * Short tier labels — the same string on the printed card and on the checkbox
 * that chooses it, deliberately. `catalog-builder`'s `PRICE_LIST_LABELS`
 * ("Precio de venta") is the long form the retired single-select used; a user
 * ticking "Venta" and reading "VENTA" off the page needs no translation
 * between the two.
 */
export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  venta: "Venta",
  taller: "Taller",
  socio: "Socio",
};
