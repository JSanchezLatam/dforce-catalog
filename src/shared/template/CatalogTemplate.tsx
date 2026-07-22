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
 */
export type CatalogTemplateBranding = {
  logoUrl: string;
  primaryColors: { primary: string; secondary: string };
  font: string;
  coverText: string;
};

export type CatalogIndexSection = {
  categoryL1: string;
  categoryL2: string | null;
  productCount: number;
};

/** R6.1 — minimal per-product print fields; reuses catalog-builder's `ProductRef` shape (no new product data-fetching added this phase). */
export type ProductPrintRef = {
  id: string;
  name: string;
  categoryL1: string | null;
  categoryL2: string | null;
};

export type CatalogTemplateProps = {
  title: string;
  branding: CatalogTemplateBranding | null;
  sections: CatalogIndexSection[];
  /** R6.1 — one array per printed page (already chunked to `productsPerPage` by `pdf-generation/render.ts`'s `chunkProducts`). Omitted for the builder's cover+index-only live preview. */
  productPages?: ProductPrintRef[][];
};

export function CatalogTemplate({ title, branding, sections, productPages = [] }: CatalogTemplateProps) {
  // R6.3 — index only ever lists sections with >=1 product. `buildIndexSections`
  // (catalog-builder/selection.ts) already guarantees this, but filtering here
  // too keeps the shared renderer correct for any future caller that passes
  // sections some other way.
  const visibleSections = sections.filter((section) => section.productCount > 0);

  return (
    <article>
      <section
        aria-label="Cover"
        style={{
          fontFamily: branding?.font || undefined,
          color: branding?.primaryColors.primary,
          background: branding?.primaryColors.secondary,
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
          <ul>
            {page.map((product) => (
              <li key={product.id}>
                {product.name}
                {product.categoryL1
                  ? ` — ${product.categoryL1}${product.categoryL2 ? ` / ${product.categoryL2}` : ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
