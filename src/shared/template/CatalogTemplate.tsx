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
 * ponytail: cover + index only — R5.5/5.6 only asks for a live title/index
 * preview in this phase, not per-product page layout (R6.1's actual product
 * pages are PR7's job). PR7 should extend this component (e.g. an optional
 * `children` slot or a `products` prop) rather than build a second template.
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

export type CatalogTemplateProps = {
  title: string;
  branding: CatalogTemplateBranding | null;
  sections: CatalogIndexSection[];
};

export function CatalogTemplate({ title, branding, sections }: CatalogTemplateProps) {
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
    </article>
  );
}
