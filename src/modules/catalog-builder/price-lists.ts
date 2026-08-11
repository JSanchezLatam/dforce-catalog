/**
 * The catalog's price-list vocabulary.
 *
 * A leaf module with no DB import, for the same reason `password-policy.ts` is
 * one: both a `"use client"` form and the server-side query need this, and
 * importing it from `queries.ts` would drag the Drizzle client into the
 * browser bundle.
 *
 * Interfuerza sends every product the same three lists in `raw.PriceLists`,
 * each `{Name, Precio, Precio_Real}`. Verified against all 694 products in the
 * live dataset:
 *
 * - The three lists are ALWAYS present, on every product.
 * - `Name` carries TRAILING WHITESPACE (`"PRECIO TALLER "`) — the same trap
 *   `Category_L1/L2` has. Never match without trimming.
 * - `Precio` is the field to use, NOT `Precio_Real`. They differ on 37
 *   products and in every one of those `Precio_Real` is 0.00 — they are all
 *   services (oil changes, gas refills). `producto.price`, projected from
 *   `Producto.Precio_Venta`, equals `Precio` on 694/694.
 * - Tiers run venta >= taller >= socio (retail, trade, member).
 */

export const PRICE_LISTS = ["venta", "taller", "socio"] as const;

export type PriceList = (typeof PRICE_LISTS)[number];

/** Shown in the generate-step selector. */
export const PRICE_LIST_LABELS: Record<PriceList, string> = {
  venta: "Precio de venta",
  taller: "Precio taller",
  socio: "Precio socio",
};

/**
 * The exact `Name` each tier carries in the ERP payload — the contract with
 * Interfuerza. Compared trimmed, so the real trailing whitespace is not
 * reproduced here.
 */
export const IFX_PRICE_LIST_NAMES: Record<PriceList, string> = {
  venta: "Precio de venta",
  taller: "PRECIO TALLER",
  socio: "Precio Socio",
};

/** List name → price, as the query returns it: ERP names, values still strings. */
export type PriceListMap = Record<string, string | null>;

/**
 * Resolves one tier out of a product's price map, or `null` when that tier has
 * no usable price.
 *
 * Zero counts as ABSENT, not as free: 32 of 694 real products carry "0.00" for
 * Precio de venta (all with zero stock), and a printed catalog showing
 * "$0.00" beside a product is worse than showing no price at all. Callers
 * render nothing for `null` rather than substituting a number.
 */
export function resolvePrice(priceLists: PriceListMap | null | undefined, list: PriceList): number | null {
  if (!priceLists) return null;

  const wanted = IFX_PRICE_LIST_NAMES[list];
  const entry = Object.entries(priceLists).find(([name]) => name.trim() === wanted);
  if (!entry) return null;

  const parsed = Number(entry[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
}
