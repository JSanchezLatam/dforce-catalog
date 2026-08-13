import type { CatalogTemplateDef } from "../registry-types";
import { DEFAULT_TEMPLATE_ID } from "../template-ids";
import { OpaqueProductCard, TransparentProductCard } from "../AdaptiveCards";

/**
 * First and (currently) only registry entry. `font`/`primaryColors` are
 * hand-translated design tokens from the proprietary `Template_Catalogo.op`
 * mockup (Letter 8.5"x11" / 816x1056 @96dpi, red `#D42027` category band,
 * black stripe/bottom band). The full page layout the mockup describes
 * (cover, band, bottom band with page number) is `CatalogTemplate`'s job,
 * not this file's — WU3 (task 3.2) is what makes `CatalogTemplate` call
 * `getTemplate()` and render it.
 *
 * `Card` here is only today's `CatalogTemplate.pickCard` strict/adaptive
 * branch, moved per design D1 — dead code until that WU3 wiring lands.
 */
/**
 * Declared once and handed to both `primaryColors` and the card, so the card's
 * two most brand-loaded marks — the category kicker and the Venta amount —
 * cannot be a second copy that a rebrand forgets. The registry exists (design
 * D1/D2) precisely so a second template cannot end up half-rebranded, and the
 * card is the half most likely to be missed.
 *
 * `#111111`, not pure black — every approved mockup file paints its wedge,
 * bands and logo plate `#111`. Pure black reads harsher in print.
 */
const COLORS = { primary: "#D42027", secondary: "#111111" };

export const dforceClassic: CatalogTemplateDef = {
  id: DEFAULT_TEMPLATE_ID,
  name: "Dforce Clásico",
  font: "Arial, sans-serif",
  primaryColors: COLORS,
  Card({ product, imageHandling }) {
    if (imageHandling === "adaptive" && product.imageType === "transparent") {
      return <TransparentProductCard product={product} colors={COLORS} />;
    }
    return <OpaqueProductCard product={product} colors={COLORS} />;
  },
};
