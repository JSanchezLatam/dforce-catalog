import type { ReactElement } from "react";

import type { ProductPrintRef } from "./CatalogTemplate";

/**
 * `CatalogTemplateDef` lives in its own type-only module so `registry.ts`
 * (which imports every template entry) and `templates/*.tsx` (which each
 * import this type to satisfy) don't import each other — a real cycle,
 * not just an erased type-only one, the moment either side needs a runtime
 * value from the other.
 */
export type CatalogTemplateDef = {
  /** Persisted as `template_config.selected_template_id`. */
  id: string;
  /** Gallery label (Spanish, user-facing). */
  name: string;
  /** `/public/templates/<id>.png` — gallery thumbnail. */
  thumbnail: string;
  font: string;
  primaryColors: { primary: string; secondary: string };
  Card: (props: { product: ProductPrintRef; imageHandling: "strict" | "adaptive" }) => ReactElement;
};
