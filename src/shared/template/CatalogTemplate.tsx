import { getTemplate } from "./registry";

/**
 * Risk-5 (design.md "New Risks Flagged" #5 — "live preview and final PDF
 * MUST share one template renderer, else layouts drift silently").
 *
 * `CatalogTemplate` is that ONE shared component. PR6's live builder
 * preview (`catalog-builder/CatalogBuilderForm.tsx`) renders it against
 * in-memory selection state; PR7's `pdf-generation` worker will render the
 * SAME component (feeding it real selection + branding data) and hand the
 * resulting HTML to Playwright's `page.pdf()`. Neither caller may fork a
 * second copy of this markup — extend the props here instead.
 *
 * It is intentionally a plain function component: no hooks, no "use client"
 * directive, no DB/session imports. That is what makes it renderable both
 * from a client component (PR6, fed by React state) and from a server
 * context (PR7 will mount it in a dedicated print route that Playwright
 * navigates to — Server Components can render it directly).
 *
 * PR7 update: extended with an optional `productPages` prop (R6.1's actual
 * per-product pages) rather than a second template — see `productPages`
 * below. Still additive/optional so PR6b's `CatalogBuilderForm` preview
 * (cover+index only, R5.5/5.6) needs no changes.
 *
 * adaptive-catalog-layouts update: extended with `defaultImageHandling` prop
 * and conditional rendering via TransparentProductCard / OpaqueProductCard.
 *
 * catalog-templates-and-workshop-info WU3 (design D1/D2): font/colours/card
 * markup are no longer part of branding — they live in the code registry
 * (`registry.ts`), keyed by `templateId`. Branding shrinks to what is either
 * template-fixed-but-selectable (`templateId`) or workshop-owned
 * (`logoUrl`/`coverText`). `logoUrl` is an http path in the live preview
 * (browser fetches the authenticated route with its session cookie) and a
 * `data:` URI in the PDF worker (Playwright cannot authenticate — see
 * worker.ts's `resolveBranding`).
 */
export type CatalogTemplateBranding = {
  templateId: string;
  logoUrl: string | null;
  coverText: string | null;
};

export type CatalogIndexSection = {
  categoryL1: string;
  categoryL2: string | null;
  productCount: number;
};

/** R6.1 — per-product print fields; extended for adaptive layouts with image + imageType. */
export type ProductPrintRef = {
  id: string;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
  image?: string | null;
  imageType?: "transparent" | "opaque" | "low_res" | null;
  /**
   * The ONE price tier this catalog was generated with, already resolved from
   * the ERP's three lists by `catalog-builder`. `null`/absent means the tier
   * had no usable price for this product and the card prints none — never
   * "$0.00", which on a printed page reads as free.
   */
  price?: number | null;
};

export type CatalogTemplateProps = {
  title: string;
  branding: CatalogTemplateBranding | null;
  sections: CatalogIndexSection[];
  /** R6.1 — one array per printed page (already chunked to `productsPerPage` by `pdf-generation/render.ts`'s `chunkProducts`). Omitted for the builder's cover+index-only live preview. */
  productPages?: ProductPrintRef[][];
  /** 'strict' forces all products to OpaqueProductCard; 'adaptive' selects card based on imageType (default: 'strict' for backward compat). */
  defaultImageHandling?: "strict" | "adaptive" | null;
};

export function CatalogTemplate({ title, branding, sections, productPages = [], defaultImageHandling }: CatalogTemplateProps) {
  const visibleSections = sections.filter((section) => section.productCount > 0);
  // Card markup is a template concern regardless of whether branding is
  // configured yet (D1) — `getTemplate` always resolves to a real entry.
  const template = getTemplate(branding?.templateId);
  const imageHandling: "strict" | "adaptive" = defaultImageHandling === "adaptive" ? "adaptive" : "strict";

  return (
    <article>
      <section
        aria-label="Cover"
        style={{
          fontFamily: branding ? template.font : undefined,
          color: branding ? template.primaryColors.primary : undefined,
          background: branding ? template.primaryColors.secondary : undefined,
          padding: "2rem",
        }}
      >
        {branding?.logoUrl && <img src={branding.logoUrl} alt="Logo" style={{ maxHeight: 80 }} />}
        <h1>{title}</h1>
        {branding?.coverText && <p>{branding.coverText}</p>}
      </section>

      <section aria-label="Index">
        <h2>Index</h2>
        {visibleSections.length === 0 ? (
          <p>No categories selected.</p>
        ) : (
          <ul>
            {visibleSections.map((section) => (
              <li key={`${section.categoryL1}::${section.categoryL2 ?? ""}`}>
                {section.categoryL1}
                {section.categoryL2 ? ` / ${section.categoryL2}` : ""} ({section.productCount})
              </li>
            ))}
          </ul>
        )}
      </section>

      {productPages.map((page, pageIndex) => (
        <section
          key={pageIndex}
          aria-label={`Product page ${pageIndex + 1}`}
          style={{ padding: "1rem", pageBreakBefore: "always" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 16,
            }}
          >
            {page.map((product) => (
              <div key={product.id}>{template.Card({ product, imageHandling })}</div>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
