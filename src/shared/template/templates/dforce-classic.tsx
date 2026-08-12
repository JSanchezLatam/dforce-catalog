import type { CatalogTemplateDef } from "../registry";
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
export const dforceClassic: CatalogTemplateDef = {
  id: DEFAULT_TEMPLATE_ID,
  name: "Dforce Clásico",
  thumbnail: "/templates/dforce-classic.png",
  font: "Arial, sans-serif",
  primaryColors: { primary: "#D42027", secondary: "#000000" },
  Card({ product, imageHandling }) {
    if (imageHandling === "adaptive" && product.imageType === "transparent") {
      return <TransparentProductCard product={product} />;
    }
    return <OpaqueProductCard product={product} />;
  },
};
