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
 *
 * WU5 (design D6): the contact columns and cover image WU1 stored had no
 * render path (sdd-verify CRITICAL finding) — `contact`/`coverImageUrl` close
 * that gap, same http-path/data-URI split as `logoUrl` for the image.
 */
export type WorkshopContact = {
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  website: string | null;
  socialHandles: Record<string, string> | null;
};

export type CatalogTemplateBranding = {
  templateId: string;
  logoUrl: string | null;
  coverText: string | null;
  /** Optional (not `design.md`'s literal required field) so every pre-WU5
   * branding literal elsewhere in this test suite keeps compiling unchanged —
   * undefined and null are both "no cover photo, degrade to the red/black
   * block" (hard constraint #4). */
  coverImageUrl?: string | null;
  /** `undefined`/`null` both mean "render no contact page" (design D6). */
  contact?: WorkshopContact | null;
};

/** design D6 — one row per contact field; filtered by presence so an unset field renders no label at all (spec, verbatim). */
const CONTACT_ROWS: { key: "phone" | "whatsapp" | "email" | "address" | "hours" | "website"; label: string }[] = [
  { key: "phone", label: "TELÉFONO" },
  { key: "whatsapp", label: "WHATSAPP" },
  { key: "email", label: "CORREO" },
  { key: "address", label: "DIRECCIÓN" },
  { key: "hours", label: "HORARIO" },
  { key: "website", label: "SITIO WEB" },
];

const CONTACT_MUTED = "#8A8A8A";

/**
 * catalog-templates-and-workshop-info WU4 (design D4): the catalog no longer
 * carries one admin-chosen price tier — every product prints all three
 * (Venta/Taller/Socio). This is the shape both `price-lists.ts`'s
 * `resolveAllPrices` and `AdaptiveCards.tsx`'s render-site em-dash guard share.
 */
export type ProductPrices = { venta: number | null; taller: number | null; socio: number | null };

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
   * All three ERP price tiers, already resolved by `catalog-builder`'s
   * `resolveAllPrices`. A tier that is `null` (absent from the payload, or an
   * ERP value `<= 0.00`) prints an em-dash — never "$0.00", which on a
   * printed page reads as free.
   */
  prices?: ProductPrices | null;
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
  const contact = branding?.contact ?? null;
  const coverImageUrl = branding?.coverImageUrl ?? null;
  const red = branding ? template.primaryColors.primary : "#D42027";
  const black = branding ? template.primaryColors.secondary : "#111111";

  return (
    <article>
      {/* design D6 / Insumos/Templates/Portada_DForce_v1.html (owner-approved
          translation target). No coverImageUrl -> the black background + red
          wedge/accent below already ARE the "red/black block" fallback (hard
          constraint #4) — no broken <img>, no empty page. */}
      <section
        aria-label="Cover"
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: 540,
          // `mix-blend-mode: multiply` only "melts" a photo's white background
          // into a WHITE page (Portada_DForce_v1.html's own comment: "funde
          // el fondo blanco del JPG con la hoja") — multiplying against black
          // is always black, which made the photo invisible. White only when
          // there IS a photo; no photo still means hard constraint #4's
          // red/black fallback block, not an empty white gap.
          background: coverImageUrl ? "#ffffff" : black,
          fontFamily: branding ? template.font : undefined,
        }}
      >
        {coverImageUrl && (
          <img
            src={coverImageUrl}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "multiply" }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "38%",
            width: "100%",
            height: "62%",
            background: black,
            clipPath: "polygon(0 64%, 100% 0, 100% 100%, 0 100%)",
          }}
        />
        <div
          style={{ position: "absolute", left: "10%", top: "58%", width: "45%", height: 4, background: red, transform: "rotate(-27deg)" }}
        />
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 24,
            width: 160,
            height: 60,
            borderRadius: 4,
            background: "#111111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {branding?.logoUrl && <img src={branding.logoUrl} alt="Logo" style={{ maxHeight: 36, maxWidth: 140 }} />}
        </div>
        <div style={{ position: "absolute", right: 24, bottom: 60, textAlign: "right", color: "#fff" }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0 }}>{title}</h1>
        </div>
        {contact?.name && (
          <p style={{ position: "absolute", left: 24, bottom: 56, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 2, margin: 0 }}>
            {contact.name}
          </p>
        )}
        {branding?.coverText && (
          <p style={{ position: "absolute", left: 24, bottom: 34, color: "#999", fontSize: 10, margin: 0 }}>{branding.coverText}</p>
        )}
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

      {/* design D6 / Template_Catalogo.op page "3 · Contacto y redes" — last
          page, after the products, matching that file's own 0/1/2/3 order.
          `contact === null` (no workshop_config row) renders no page at all,
          never an empty one. */}
      {contact && (
        <section
          aria-label="Contact"
          style={{
            pageBreakBefore: "always",
            background: black,
            color: "#fff",
            padding: "2rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: 160,
                height: 56,
                borderRadius: 4,
                background: "#1c1c1c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {branding?.logoUrl && <img src={branding.logoUrl} alt="Logo" style={{ maxHeight: 36, maxWidth: 140 }} />}
            </div>
            {contact.name && <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, margin: 0 }}>{contact.name}</p>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {CONTACT_ROWS.filter((row) => contact[row.key]).map((row) => (
              <div key={row.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: red, flexShrink: 0 }} />
                <span>
                  <span style={{ display: "block", fontSize: 8, fontWeight: 800, letterSpacing: 1.5, color: CONTACT_MUTED }}>
                    {row.label}
                  </span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{contact[row.key]}</span>
                </span>
              </div>
            ))}
          </div>

          {contact.socialHandles && Object.keys(contact.socialHandles).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 3, color: CONTACT_MUTED }}>SEGUINOS EN REDES</span>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.5rem" }}>
                {Object.entries(contact.socialHandles).map(([platform, handle]) => (
                  <span
                    key={platform}
                    style={{ border: "1px solid #3A3A3A", borderRadius: 16, padding: "0.4rem 0.9rem", fontSize: 9, fontWeight: 600 }}
                  >
                    {platform}: {handle}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </article>
  );
}
