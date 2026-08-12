import type { ReactElement } from "react";

import type { ProductPrintRef } from "./CatalogTemplate";

/**
 * `CatalogTemplateDef` lives in its own type-only module so `registry.ts`
 * (which imports every template entry) and `templates/*.tsx` (which each
 * import this type to satisfy) don't import each other directly. This does
 * NOT fully break the cycle: `ProductPrintRef` still comes from
 * `CatalogTemplate.tsx`, and WU3 (task 3.2) makes `CatalogTemplate` import
 * `registry.ts` — so the cycle becomes `CatalogTemplate → registry →
 * registry-types → CatalogTemplate`, still type-only (erased at compile
 * time) unless a future template needs a runtime value from
 * `CatalogTemplate.tsx`, which none does today. WU3 should re-check this
 * before adding any runtime (non-`import type`) edge along that path.
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
