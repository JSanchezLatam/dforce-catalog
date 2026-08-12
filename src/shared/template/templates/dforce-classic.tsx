import type { CatalogTemplateDef } from "../registry";
import { OpaqueProductCard, TransparentProductCard } from "../AdaptiveCards";

/**
 * First and (currently) only registry entry — hand-translated from the
 * proprietary `Template_Catalogo.op` mockup (Letter 8.5"x11" / 816x1056 @96dpi):
 * a red `#D42027` category band carrying the logo, a 12px black stripe, a
 * body of product rows filling the sheet, and a solid black bottom band with
 * the brand name and a page number in a red circle.
 *
 * `Card` is today's `CatalogTemplate.pickCard` strict/adaptive branch, moved
 * here per design D1 — dead code until WU3 wires `getTemplate()` into
 * `CatalogTemplate`.
 */
export const dforceClassic: CatalogTemplateDef = {
  id: "dforce-classic",
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
