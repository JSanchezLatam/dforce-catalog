import type { ReactElement } from "react";

import type { ProductPrintRef } from "./CatalogTemplate";
import { dforceClassic } from "./templates/dforce-classic";
import { DEFAULT_TEMPLATE_ID } from "./template-ids";

export { DEFAULT_TEMPLATE_ID } from "./template-ids";

/**
 * Code registry (design D1) — one entry per catalog template. Page
 * structure is JSX, not data, so a template is a file + an array element,
 * not a DB row. Additive and unwired in WU2 (`CatalogTemplate` still owns
 * its own `pickCard` branch); WU3 makes `CatalogTemplate` call `getTemplate()`
 * and delegate to `Card`.
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

export const CATALOG_TEMPLATES: CatalogTemplateDef[] = [dforceClassic];

/** R8.4 — an unknown or missing id (never-persisted, or orphaned by a registry edit) falls back to the default; never returns null/throws. */
export function getTemplate(id?: string | null): CatalogTemplateDef {
  return CATALOG_TEMPLATES.find((template) => template.id === id) ?? getDefaultTemplate();
}

function getDefaultTemplate(): CatalogTemplateDef {
  const fallback = CATALOG_TEMPLATES.find((template) => template.id === DEFAULT_TEMPLATE_ID);
  if (!fallback) {
    throw new Error(`CATALOG_TEMPLATES is missing the default template "${DEFAULT_TEMPLATE_ID}"`);
  }
  return fallback;
}
