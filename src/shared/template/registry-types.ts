import type { ReactElement } from "react";

import type { ProductPrintRef } from "./CatalogTemplate";
import type { PriceTier } from "./price-tiers";

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
/** The contact fields a template can print, in `CatalogTemplate`'s canonical order. */
export type ContactRowKey = "phone" | "whatsapp" | "email" | "address" | "hours" | "website";

/**
 * Optional page seams. A template that defines `Cover` / `Back` replaces the
 * stock cover and contact sheet; the seams return CONTENT only, because
 * `CatalogTemplate` owns the `<Sheet>` (its `data-sheet` attribute is what
 * every test and the preview script select on). Rows and socials arrive as
 * props, already filtered by the presence rule — a template importing
 * `CONTACT_ROWS` from `CatalogTemplate.tsx` would turn this module's type-only
 * cycle into a runtime one.
 */
export type CoverProps = {
  title: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  workshopName: string | null;
  coverText: string | null;
  red: string;
};

export type BackProps = {
  rows: { key: ContactRowKey; label: string; value: string }[];
  socials: [string, string][];
  logoUrl: string | null;
  coverImageUrl: string | null;
  red: string;
};

export type CatalogTemplateDef = {
  /** Persisted as `template_config.selected_template_id`. */
  id: string;
  /** Gallery label (Spanish, user-facing). */
  name: string;
  /**
   * `/public/templates/<id>.png` — gallery thumbnail. Optional: no template
   * ships one yet, and a required field pointing at a file that does not
   * exist is a broken `<img>` waiting for the first caller that trusts it.
   * The gallery renders a text placeholder while this is absent.
   */
  thumbnail?: string;
  font: string;
  primaryColors: { primary: string; secondary: string };
  Cover?: (props: CoverProps) => ReactElement;
  Back?: (props: BackProps) => ReactElement;
  Card: (props: { product: ProductPrintRef; imageHandling: "strict" | "adaptive"; tiers: readonly PriceTier[] }) => ReactElement;
};
