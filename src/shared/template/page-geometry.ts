/**
 * The printed page, in CSS px, as the owner-approved mockups draw it.
 *
 * Every page in `Insumos/Templates/` (`Portada_DForce_v1.html` and the four
 * `Template_Catalogo.op` pages) is a full-bleed Letter sheet: 8.5in x 11in at
 * Chromium's 96dpi print layout, with the red header band and black footer
 * band running edge to edge. That is only reachable with `@page { margin: 0 }`
 * — a page margin would inset the bands and leave a white frame the design
 * never had. The per-page padding below replaces the margin INSIDE the sheet,
 * where the bands can still bleed past it.
 *
 * These live in one module rather than beside the markup because three
 * separate consumers need the same numbers and none of them may retype one:
 *   - `CatalogTemplate` draws the bands and the content box,
 *   - `render.ts` emits the matching `@page` rule,
 *   - `worker.ts` sizes the Playwright viewport and derives the usable height
 *     the page packer splits against.
 * A number retyped in two of those is a layout that silently paginates against
 * a page it does not print.
 */

/** 8.5in x 11in at 96dpi. `page.pdf({ format: "Letter" })` must agree. */
export const PAGE_WIDTH_PX = 816;
export const PAGE_HEIGHT_PX = 1056;

/** Red category/section band across the top of every content page. */
export const HEADER_BAND_PX = 118;
/** The thin black rule immediately under the red band. */
export const HEADER_STRIPE_PX = 12;
/** Black footer band carrying the workshop name and the page number. */
export const FOOTER_BAND_PX = 104;

/** Inset of the content box within the sheet. The bands ignore it by design. */
export const CONTENT_PAD_X_PX = 48;
export const CONTENT_PAD_TOP_PX = 38;
export const CONTENT_PAD_BOTTOM_PX = 24;

/** Width one content page actually gives its grid. */
export const CONTENT_WIDTH_PX = PAGE_WIDTH_PX - 2 * CONTENT_PAD_X_PX;

/**
 * Height one content page actually gives its grid — what `chunkProducts`
 * splits against.
 *
 * Derived, never typed in: the bands and padding are the only things standing
 * between the sheet and the grid, so subtracting them is the definition of
 * "what is left". Before this, `worker.ts` computed the same idea from A4
 * minus a 20mm `@page` margin and measured the section's own CSS padding in
 * the browser to find its `chrome`. Neither survives a full-bleed page: there
 * is no margin left to subtract, and the bands are elements rather than
 * padding, so a computed-style read would report 0 and hand the packer a page
 * ~222px taller than it prints.
 */
export const CONTENT_HEIGHT_PX =
  PAGE_HEIGHT_PX - HEADER_BAND_PX - HEADER_STRIPE_PX - FOOTER_BAND_PX - CONTENT_PAD_TOP_PX - CONTENT_PAD_BOTTOM_PX;

/**
 * The cover and the index occupy printed pages 1 and 2, so the first product
 * page prints as page 3. The index prints these numbers next to each category
 * and the footer prints one per page; both read it from here so they can never
 * disagree about where the products start.
 */
export const FIRST_PRODUCT_PAGE_NUMBER = 3;
