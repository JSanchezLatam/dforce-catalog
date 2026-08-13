import { getTemplate } from "./registry";
import {
  CONTENT_HEIGHT_PX,
  CONTENT_PAD_BOTTOM_PX,
  CONTENT_PAD_TOP_PX,
  CONTENT_PAD_X_PX,
  FIRST_INDEX_PAGE_NUMBER,
  FOOTER_BAND_PX,
  HEADER_BAND_PX,
  HEADER_STRIPE_PX,
  INDEX_HEADER_ROW_PX,
  INDEX_ROWS_PER_PAGE,
  INDEX_ROW_HEIGHT_PX,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  firstProductPageNumber,
} from "./page-geometry";

/**
 * Risk-5 (design.md "New Risks Flagged" #5 — "live preview and final PDF
 * MUST share one template renderer, else layouts drift silently").
 *
 * `CatalogTemplate` is that ONE shared component. The builder's live preview
 * (`catalog-builder/CatalogBuilderForm.tsx`) renders it against in-memory
 * selection state; the `pdf-generation` worker renders the SAME component
 * (feeding it real selection + branding data) and hands the resulting HTML to
 * Playwright's `page.pdf()`. Neither caller may fork a second copy of this
 * markup — extend the props here instead.
 *
 * It is intentionally a plain function component: no hooks, no "use client"
 * directive, no DB/session imports. That is what makes it renderable both
 * from a client component (fed by React state) and from a server context.
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
 *
 * mockup translation: the layout is no longer approximated. Every page is a
 * full-bleed Letter sheet translated coordinate-for-coordinate from the two
 * owner-approved sources — `Insumos/Templates/Portada_DForce_v1.html` for the
 * cover and `Template_Catalogo.op` (pages "1 · Índice", "2 · Productos",
 * "3 · Contacto y redes") for the rest. Page geometry lives in
 * `page-geometry.ts` because the renderer and the page packer must agree on
 * it exactly.
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
   * undefined and null are both "no cover photo". */
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

/** Mockup neutrals. Not registry tokens: they are layout ink shared by every
 * template's chrome, not the per-template brand pair the registry keys on. */
const INK_MUTED = "#8f8f8f";
const INK_FAINT = "#7a7a7a";
const ROW_TINT = "#f2f2f2";
const HAIRLINE = "#e6e6e6";

/**
 * Keeps a run of unbounded text to exactly one line.
 *
 * Two places print a list nobody bounds — the index row's subcategories and
 * the product band's categories — into a box whose height the page geometry
 * has already committed to. CSS `height` on a table row is a MINIMUM, and the
 * bands do not clip, so an unclamped list does not overflow its own box: it
 * pushes the rest of the page over the footer band and off the paper. One
 * elided line is a legible compromise; a lost category is not.
 */
const CLAMP_TO_ONE_LINE: React.CSSProperties = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

/**
 * True only when there is something worth printing a page for. `name` alone
 * does not qualify — the brand name already appears on the cover, so a page
 * carrying nothing else is still a blank page with a heading.
 */
function hasContactContent(contact: WorkshopContact | null | undefined): boolean {
  if (!contact) return false;
  const hasRow = CONTACT_ROWS.some((row) => contact[row.key]);
  const hasSocial = !!contact.socialHandles && Object.keys(contact.socialHandles).length > 0;
  return hasRow || hasSocial;
}

/**
 * catalog-templates-and-workshop-info WU4 (design D4): the catalog no longer
 * carries one admin-chosen price tier — every product prints all three
 * (Venta/Taller/Socio). This is the shape both `price-lists.ts`'s
 * `resolveAllPrices` and `AdaptiveCards.tsx`'s render-site em-dash guard share.
 */
export type ProductPrices = { venta: number | null; taller: number | null; socio: number | null };

/**
 * The product grid's column count. Lives here, with the grid it describes,
 * because `pdf-generation`'s page packing has to form the same rows this
 * component renders — a row is as tall as its tallest card, so a packer
 * pairing cards two-by-two against a three-column grid would sum heights for
 * a layout that never gets printed. Imported by `pdf-generation/render.ts`,
 * never retyped there (`shared` may not import from `modules`).
 */
export const GRID_COLUMNS = 2;
/**
 * Grid gutter, in px — private, unlike its sibling `GRID_COLUMNS`, and the
 * asymmetry is deliberate rather than an oversight.
 *
 * The rule `page-geometry.ts` states is "never retype a number in two places".
 * Reading it back off the rendered grid is not a second copy — it is the same
 * number, measured. `worker.ts` folds the gap into every card height by asking
 * the browser for the grid's computed `rowGap`, so changing it here cannot
 * desynchronise anything. The column count has no such measurement available:
 * the packer must form rows BEFORE the split exists, so it has to be told.
 */
const GRID_GAP_PX = 14;

export type CatalogIndexSection = {
  categoryL1: string;
  categoryL2: string | null;
  productCount: number;
};

/** R6.1 — per-product print fields; extended for adaptive layouts with image + imageType. */
export type ProductPrintRef = {
  /** The ERP product id, verbatim (`producto.id`). The card prints it as the
   * "Cód." line the mockup shows, so this doubles as the product code. */
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
  /** R6.1 — one array per printed page (already chunked by `pdf-generation/render.ts`'s `chunkProducts`). Omitted for the builder's cover+index-only live preview. */
  productPages?: ProductPrintRef[][];
  /** 'strict' forces all products to OpaqueProductCard; 'adaptive' selects card based on imageType (default: 'strict' for backward compat). */
  defaultImageHandling?: "strict" | "adaptive" | null;
};

/** One printed row of the index table (mockup page "1 · Índice"). */
export type CatalogIndexRow = {
  categoryL1: string;
  /** The L1's distinct L2s, in section order — the small line under the name. */
  subcategories: string[];
  productCount: number;
  /** Printed page the L1 first appears on, or `null` when there are no product
   * pages to point at (the builder's cover+index-only preview). */
  pageNumber: number | null;
};

/**
 * Collapses the flat L1/L2 sections into the mockup's one-row-per-L1 table and
 * resolves each row's printed page number.
 *
 * The sections arrive one per L1/L2 pair, but the approved index prints ONE
 * row per L1 with its L2s as a subtitle and a single summed count — so the
 * grouping has to happen somewhere, and it happens here rather than in the
 * JSX so it is testable without rendering.
 *
 * Page numbers are resolved from `productPages` rather than counted from the
 * section list: the packer splits by MEASURED height, so how many pages a
 * category spans is not derivable from its product count. Looking up where the
 * category's first product actually landed is the only answer that survives a
 * page break the count cannot predict.
 */
/** The whole index: its sheets, and where the products start after them. */
export type CatalogIndex = {
  pages: CatalogIndexRow[][];
  /**
   * The printed number of the first product page. Returned rather than
   * recomputed by the caller: the number a category shows in the index and the
   * number that page shows in its own footer come from this one value, so
   * there is no second derivation to drift out of step with the first.
   */
  firstProductPage: number;
};

export function buildIndex(
  sections: CatalogIndexSection[],
  productPages: ProductPrintRef[][] = [],
): CatalogIndex {
  const rows: { categoryL1: string; subcategories: string[]; productCount: number }[] = [];
  const rowIndex = new Map<string, number>();

  for (const section of sections) {
    if (section.productCount <= 0) continue;

    let at = rowIndex.get(section.categoryL1);
    if (at === undefined) {
      at = rows.length;
      rowIndex.set(section.categoryL1, at);
      rows.push({ categoryL1: section.categoryL1, subcategories: [], productCount: 0 });
    }

    const row = rows[at];
    if (!row) continue;
    row.productCount += section.productCount;
    if (section.categoryL2 && !row.subcategories.includes(section.categoryL2)) {
      row.subcategories.push(section.categoryL2);
    }
  }

  // Chunk FIRST, then number: the index's own length decides where the
  // products start, because an index needing a second sheet pushes every
  // product page down by one. Deriving that count here and again in the
  // component would be two derivations of one number — the exact duplication
  // `page-geometry.ts` exists to prevent — so the count is taken once, from
  // the pages themselves, and handed back with them.
  const pages = chunkIndexRows(rows);
  const firstProductPage = firstProductPageNumber(pages.length);

  const numbered = rows.map((row) => {
    const pageIndex = productPages.findIndex((page) =>
      page.some((product) => product.categoryL1 === row.categoryL1),
    );
    return {
      ...row,
      pageNumber: pageIndex === -1 ? null : firstProductPage + pageIndex,
    };
  });

  return { pages: chunkIndexRows(numbered), firstProductPage };
}

/** Splits the index into sheets of `INDEX_ROWS_PER_PAGE`. Always at least one. */
function chunkIndexRows<T>(rows: T[]): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let at = 0; at < rows.length; at += INDEX_ROWS_PER_PAGE) {
    pages.push(rows.slice(at, at + INDEX_ROWS_PER_PAGE));
  }
  return pages;
}

/**
 * The red band's heading for one product page.
 *
 * Lists EVERY L1 on the page, not just the first. `chunkProducts` splits by
 * count and measured height and has no concept of a category boundary, so
 * every category transition lands mid-page: a page routinely holds the tail of
 * one category and the head of the next. Naming only the first made the band
 * deny that the second was there — while the index pointed the reader at that
 * exact page to find it. Two printed pages contradicting each other is worse
 * than a longer heading.
 */
function pageHeading(page: ProductPrintRef[]): { title: string; subtitle: string } {
  const categories: string[] = [];
  const subcategories: string[] = [];
  for (const product of page) {
    if (product.categoryL1 && !categories.includes(product.categoryL1)) {
      categories.push(product.categoryL1);
    }
    if (product.categoryL2 && !subcategories.includes(product.categoryL2)) {
      subcategories.push(product.categoryL2);
    }
  }
  return {
    title: categories.length > 0 ? categories.join(" · ") : "PRODUCTOS",
    subtitle: subcategories.join(" · "),
  };
}

/**
 * One full-bleed sheet. Every page in the catalog is one of these, so the
 * `@page { margin: 0 }` rule in `render.ts` has an element of exactly the
 * paper's size to fill.
 *
 * Deliberately NOT `overflow: hidden`. Only the cover needs clipping (its
 * photo is wider than the sheet on purpose), and it asks for it by hand.
 * Clipping every sheet would make an overflowing product page fail SILENTLY:
 * `chunkProducts` knowingly places a card taller than a whole page alone and
 * leaves the overflow to the browser, so a hidden overflow turns that case
 * into a card sliced off mid-price in a document a customer reads. A page that
 * visibly runs long is a bug someone reports; a page that quietly loses its
 * last row is not.
 */
function Sheet({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section
      aria-label={label}
      style={{
        position: "relative",
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
        background: "#ffffff",
        breakAfter: "page",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Red band + black rule + black footer: the chrome every content page shares. */
function PageChrome({
  heading,
  subheading,
  logoUrl,
  workshopName,
  footerNote,
  pageNumber,
  red,
  black,
}: {
  heading: string;
  subheading: string;
  logoUrl: string | null;
  workshopName: string | null;
  footerNote: string;
  pageNumber: number;
  red: string;
  black: string;
}) {
  return (
    <>
      <div style={{ position: "absolute", inset: `0 0 auto 0`, height: HEADER_BAND_PX, background: red }}>
        <h2
          style={{
            position: "absolute",
            left: CONTENT_PAD_X_PX,
            top: 30,
            margin: 0,
            color: "#fff",
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: -0.5,
            textTransform: "uppercase",
            // Stops short of the logo plate rather than running under it.
            maxWidth: PAGE_WIDTH_PX - 2 * CONTENT_PAD_X_PX - 190,
            ...CLAMP_TO_ONE_LINE,
          }}
        >
          {heading}
        </h2>
        {subheading && (
          <p
            style={{
              position: "absolute",
              left: CONTENT_PAD_X_PX,
              top: 76,
              margin: 0,
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 2.2,
              textTransform: "uppercase",
              maxWidth: PAGE_WIDTH_PX - 2 * CONTENT_PAD_X_PX - 190,
              ...CLAMP_TO_ONE_LINE,
            }}
          >
            {subheading}
          </p>
        )}
        <LogoPlate logoUrl={logoUrl} style={{ position: "absolute", right: CONTENT_PAD_X_PX, top: 22, background: black }} />
      </div>
      <div style={{ position: "absolute", left: 0, top: HEADER_BAND_PX, width: "100%", height: HEADER_STRIPE_PX, background: black }} />

      <div style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: FOOTER_BAND_PX, background: black }}>
        {workshopName && (
          <p
            style={{
              position: "absolute",
              left: CONTENT_PAD_X_PX,
              top: 36,
              margin: 0,
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 2.5,
              textTransform: "uppercase",
            }}
          >
            {workshopName}
          </p>
        )}
        <p style={{ position: "absolute", left: CONTENT_PAD_X_PX, top: 58, margin: 0, color: INK_FAINT, fontSize: 9 }}>
          {footerNote}
        </p>
        <div
          style={{
            position: "absolute",
            right: CONTENT_PAD_X_PX,
            top: 26,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: red,
            color: "#fff",
            fontSize: 18,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {pageNumber}
        </div>
      </div>
    </>
  );
}

/** The dark logo plate, identical on the cover, the band and the contact page. */
function LogoPlate({ logoUrl, style }: { logoUrl: string | null; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: 160,
        height: 60,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {logoUrl && <img src={logoUrl} alt="Logo" style={{ maxHeight: 40, maxWidth: 132 }} />}
    </div>
  );
}

/** The content box a content page's body sits in, between the bands. */
function ContentBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: CONTENT_PAD_X_PX,
        right: CONTENT_PAD_X_PX,
        top: HEADER_BAND_PX + HEADER_STRIPE_PX + CONTENT_PAD_TOP_PX,
        height: CONTENT_HEIGHT_PX,
      }}
    >
      {children}
    </div>
  );
}

export function CatalogTemplate({ title, branding, sections, productPages = [], defaultImageHandling }: CatalogTemplateProps) {
  // Card markup is a template concern regardless of whether branding is
  // configured yet (D1) — `getTemplate` always resolves to a real entry.
  const template = getTemplate(branding?.templateId);
  const imageHandling: "strict" | "adaptive" = defaultImageHandling === "adaptive" ? "adaptive" : "strict";
  const contact = branding?.contact ?? null;
  const coverImageUrl = branding?.coverImageUrl ?? null;
  const red = branding ? template.primaryColors.primary : "#D42027";
  const black = branding ? template.primaryColors.secondary : "#111111";
  const workshopName = contact?.name ?? null;
  // One value, used both to number the categories inside the index and to
  // number the product pages' own footers. They cannot disagree because
  // neither recomputes it.
  const { pages: indexPages, firstProductPage } = buildIndex(sections, productPages);

  return (
    <article style={{ fontFamily: branding ? template.font : undefined }}>
      {/* Insumos/Templates/Portada_DForce_v1.html, translated coordinate for
          coordinate. The sheet is WHITE unconditionally, which is both what
          the approved file does and the fix for two bugs of the same family:
          the photo composited with `mix-blend-mode: multiply` vanished against
          a dark sheet (archive gap #4), and with no photo the old dark sheet
          also hid the dark wedge that is supposed to contrast against it.
          A fallback colour equal to the colour it must contrast with is
          invisible — so the sheet never wears the wedge's colour. */}
      {/* The one sheet that clips: the cover photo is 902px wide on an 816px
          sheet and hangs off the right edge by design. */}
      <Sheet label="Cover" style={{ overflow: "hidden" }}>
        {coverImageUrl && (
          <img
            src={coverImageUrl}
            alt=""
            style={{ position: "absolute", top: 74, right: -118, width: 902, mixBlendMode: "multiply" }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 620,
            width: 430,
            height: 5,
            background: red,
            transform: "rotate(-27.2deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 400,
            width: PAGE_WIDTH_PX,
            height: 656,
            background: black,
            clipPath: "polygon(0 64%, 100% 0, 100% 100%, 0 100%)",
          }}
        />
        <LogoPlate
          logoUrl={branding?.logoUrl ?? null}
          style={{ position: "absolute", top: 46, left: 48, width: 196, height: 74, background: black }}
        />
        {/* The approved file hard-codes the break ("CATÁLOGO<br>DE PRODUCTOS")
            because its title is a literal. Ours is whatever the workshop typed,
            so the break has to come from a width instead: unconstrained, a
            52px title runs the full sheet and lands on top of the workshop
            name in the opposite corner. 430px is the mockup's own title block,
            which keeps the left corner free whatever the title says. */}
        <div style={{ position: "absolute", right: 48, bottom: 96, display: "flex", gap: 22, alignItems: "stretch" }}>
          <div style={{ textAlign: "right", maxWidth: 430 }}>
            <h1 style={{ margin: 0, color: "#fff", fontSize: 52, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase" }}>
              {title}
            </h1>
          </div>
          <div style={{ width: 6, background: red }} />
        </div>
        {workshopName && (
          <p
            style={{
              position: "absolute",
              left: 48,
              bottom: 100,
              margin: 0,
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 2.5,
              textTransform: "uppercase",
            }}
          >
            {workshopName}
          </p>
        )}
        {branding?.coverText && (
          <p style={{ position: "absolute", left: 48, bottom: 74, margin: 0, color: INK_FAINT, fontSize: 10, letterSpacing: 0.6 }}>
            {branding.coverText}
          </p>
        )}
      </Sheet>

      {/* Template_Catalogo.op, page "1 · Índice" — a table with a dark header
          row, tinted alternating rows, the count in grey and the page number
          in red. In Spanish, as the mockup writes it. */}
      {indexPages.map((pageRows, pageIndex) => (
        <Sheet key={pageIndex} label={pageIndex === 0 ? "Index" : `Index page ${pageIndex + 1}`}>
          <PageChrome
            heading="Índice"
            subheading={title}
            logoUrl={branding?.logoUrl ?? null}
            workshopName={workshopName}
            footerNote="Lista de precios · Venta · Taller · Socio"
            pageNumber={FIRST_INDEX_PAGE_NUMBER + pageIndex}
            red={red}
            black={black}
          />
          <ContentBox>
            {pageRows.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: INK_MUTED }}>No hay categorías seleccionadas.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead>
                  <tr style={{ background: black, color: "#fff", height: INDEX_HEADER_ROW_PX }}>
                    <th style={{ textAlign: "left", padding: "0 16px", fontSize: 8, fontWeight: 800, letterSpacing: 1.8 }}>
                      CATEGORÍA
                    </th>
                    <th style={{ width: 110, textAlign: "right", padding: "0 16px", fontSize: 8, fontWeight: 800, letterSpacing: 1.8 }}>
                      PRODUCTOS
                    </th>
                    <th style={{ width: 78, textAlign: "right", padding: "0 16px", fontSize: 8, fontWeight: 800, letterSpacing: 1.8 }}>
                      PÁG.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, rowIndex) => (
                    <tr
                      key={row.categoryL1}
                      // Fixed height, so `INDEX_ROWS_PER_PAGE` is arithmetic
                      // rather than a guess about how tall a row turned out.
                      style={{
                        height: INDEX_ROW_HEIGHT_PX,
                        background: rowIndex % 2 === 0 ? ROW_TINT : "#ffffff",
                        borderBottom: `1px solid ${HAIRLINE}`,
                      }}
                    >
                      <td style={{ padding: "0 16px" }}>
                        <span
                          style={{ display: "block", fontSize: 13, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", ...CLAMP_TO_ONE_LINE }}
                        >
                          {row.categoryL1}
                        </span>
                        {row.subcategories.length > 0 && (
                          <span style={{ display: "block", marginTop: 3, fontSize: 8, color: INK_MUTED, ...CLAMP_TO_ONE_LINE }}>
                            {row.subcategories.join(" · ")}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", padding: "0 16px", fontSize: 11, color: INK_MUTED }}>{row.productCount}</td>
                      <td style={{ textAlign: "right", padding: "0 16px", fontSize: 20, fontWeight: 800, color: red }}>
                        {row.pageNumber ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ContentBox>
        </Sheet>
      ))}

      {/* Template_Catalogo.op, page "2 · Productos" — the red band carries the
          category the page holds, so the reader can find it without the index. */}
      {productPages.map((page, pageIndex) => {
        const { title: heading, subtitle } = pageHeading(page);
        return (
          <Sheet key={pageIndex} label={`Product page ${pageIndex + 1}`}>
            <PageChrome
              heading={heading}
              subheading={subtitle}
              logoUrl={branding?.logoUrl ?? null}
              workshopName={workshopName}
              footerNote="Venta · Taller · Socio"
              pageNumber={firstProductPage + pageIndex}
              red={red}
              black={black}
            />
            <ContentBox>
              {/* `worker.ts` finds the grid by this attribute to measure its
                  cards. It used to select the section's first child div, which
                  the header band silently became the moment this page grew
                  chrome — an attribute cannot be stolen by a sibling. */}
              <div
                data-product-grid=""
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
                  gap: GRID_GAP_PX,
                  alignContent: "start",
                }}
              >
                {page.map((product) => (
                  <div key={product.id}>{template.Card({ product, imageHandling })}</div>
                ))}
              </div>
            </ContentBox>
          </Sheet>
        );
      })}

      {/* design D6 / Template_Catalogo.op page "3 · Contacto y redes" — last
          page, after the products, matching that file's own 0/1/2/3 order.

          The guard checks for CONTENT, not for a non-null object. Because
          `workshop_config` is a singleton row WU1's migration guarantees
          exists, `buildWorkshopContact` returns an object of nulls — never
          `null` — for a workshop that has not filled contact info in yet.
          Guarding on `contact != null` alone appended a blank black page to
          every catalog from such a workshop. */}
      {hasContactContent(contact) && contact && (
        <Sheet label="Contact" style={{ background: black }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: `${CONTENT_PAD_TOP_PX + 40}px ${CONTENT_PAD_X_PX}px ${CONTENT_PAD_BOTTOM_PX}px`,
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 40,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <LogoPlate logoUrl={branding?.logoUrl ?? null} style={{ background: "#1c1c1c" }} />
              {contact.name && (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase" }}>
                  {contact.name}
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {CONTACT_ROWS.filter((row) => contact[row.key]).map((row) => (
                <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ width: 34, height: 34, borderRadius: "50%", background: red, flexShrink: 0 }} />
                  <span>
                    <span style={{ display: "block", fontSize: 8, fontWeight: 800, letterSpacing: 1.5, color: CONTACT_MUTED }}>
                      {row.label}
                    </span>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{contact[row.key]}</span>
                  </span>
                </div>
              ))}
            </div>

            {contact.socialHandles && Object.keys(contact.socialHandles).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 3, color: CONTACT_MUTED }}>SEGUINOS EN REDES</span>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
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
          </div>
        </Sheet>
      )}
    </article>
  );
}
