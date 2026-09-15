# Spec: catalog-generation

Catalog generation pipeline: product selection, image handling, review, and PDF rendering with dynamic content.

## Requirements

### Requirement: Selection (R5)

The selection flow MUST carry `image` and `image_type` alongside each product from the moment candidates are loaded. The `ProductRef` type MUST include `image?: string | null` and `imageType?: "transparent" | "opaque" | "low_res"`. Before enqueuing generation, the system MUST present a review step where the user inspects per-product image types.

#### Scenario: Mixed image types displayed

- GIVEN products with mixed image types
- WHEN the user opens the review step
- THEN the system SHALL display an image-type indicator (transparent/opaque/low_res) per product row

#### Scenario: Unknown image type

- GIVEN a product with `image_type = null`
- WHEN the review step renders
- THEN the system SHALL display "unknown" as the image-type indicator

#### Scenario: Low resolution is advisory only

- GIVEN a low-resolution product image
- WHEN the user reviews the selection
- THEN the system MUST NOT block generation — the indicator is advisory, not gating

### Requirement: PDF Catalog Generation (R6)

The `ProductPrintRef` type MUST be extended with `image?: string | null` and `imageType?: "transparent" | "opaque" | "low_res"`, and with `prices?: {venta, taller, socio}` (all `number | null`). The PDF MUST apply the branding of the template selected in `template-config` (font and colors from the registry) and the workshop's cover text and contact information from `workshop-settings`. Every product card SHALL show one price row per tier CHOSEN for that catalog — between one and two of `venta`, `taller`, `socio` — in bold, in the canonical order `venta, taller, socio`. A chosen tier with no usable price (absent from the payload, or an ERP value `<= 0.00`) SHALL render an em-dash (`—`), never `$0.00` and never a blank line. A tier that was NOT chosen SHALL be absent from the card entirely, with no row and no em-dash: an em-dash states "this catalog quotes that list and this product has no price", which is a different and false claim. Image cards are rendered according to their image type (transparent → full-bleed, opaque/low_res → polaroid frame).

The page footer SHALL name exactly the chosen tiers, derived from the same selection the cards render. A footer naming a list the cards do not carry is the one error a customer reads directly off the page.

`productsPerPage` is a **maximum**, not an exact count: the binding constraint is the printed page's own height. A printed page MUST hold no more than `productsPerPage` products AND no more products than physically fit within A4 minus the page margin. Card heights MUST be measured in the rendering browser at the printed page's content width, never estimated. (Wording corrected here from an exact count: the earlier reading was what allowed archive gap #1 — a 10-product "page" silently spilling onto a second physical sheet once WU4's three-row price table made cards taller. The count never described what the paper could deliver.)

#### Scenario: A page holds fewer products than requested when they do not fit

- GIVEN `productsPerPage = 10` and cards tall enough that only 4 fit on an A4 page
- WHEN the PDF is rendered
- THEN each printed page MUST carry at most 4 products, and every logical page MUST occupy exactly one physical page

#### Scenario: The requested count still caps a page that could hold more

- GIVEN `productsPerPage = 6` and cards short enough that 10 would fit
- WHEN the PDF is rendered
- THEN each printed page MUST carry at most 6 products

#### Scenario: A product taller than a whole page

- GIVEN a product card taller than the usable height of an A4 page
- WHEN the PDF is rendered
- THEN it MUST be placed on a page of its own and the pagination MUST terminate — never retried against a fresh empty page

#### Scenario: Transparent image card

- GIVEN a product with `imageType = "transparent"`
- WHEN the PDF is rendered
- THEN the system MUST use a full-bleed image card with no frame

#### Scenario: Opaque image card

- GIVEN a product with `imageType = "opaque"` or `"low_res"`
- WHEN the PDF is rendered
- THEN the system MUST use a polaroid-style card with white border

#### Scenario: Missing image uses placeholder

- GIVEN a product with `image = null`
- WHEN the PDF is rendered
- THEN the system MUST use an opaque-style card with a placeholder

#### Scenario: Only the chosen tiers appear

- GIVEN a product with venta=120.00, taller=100.00, socio=90.00
- AND the catalog chose Venta and Socio
- WHEN its card renders
- THEN the Venta and Socio prices MUST appear, each bold and labeled
- AND no Taller row MUST be present, neither priced nor em-dashed

#### Scenario: Footer names the chosen lists

- GIVEN the catalog chose Venta and Socio
- WHEN any index or product page renders
- THEN its footer MUST read "Venta · Socio" and MUST NOT name Taller

#### Scenario: A zero tier renders an em-dash

- GIVEN a real product where `socio = 0.00` (verified present in production data)
- AND the catalog chose Venta and Socio
- WHEN its card renders
- THEN the Socio line MUST show `—`, never `$0.00`, while Venta still shows its bold price

#### Scenario: A missing tier renders an em-dash

- GIVEN a product whose payload omits the `taller` field entirely
- AND the catalog chose Taller
- WHEN its card renders
- THEN the Taller line MUST show `—`, exactly as the zero-value case

### Requirement: Image Classification (R12)

The inventory-sync mapper MUST classify each product's image at sync time via client-side heuristic and persist `image_type` in the `producto` table. Classification criteria — a product image MUST be classified as:
- `"transparent"` — image URL ends with `.png` and common transparent-domain prefixes (e.g. `*-transparent`, `*-sin-fondo`)
- `"opaque"` — image URL ends with `.jpg`, `.jpeg`, `.webp`, or any PNG without transparent-domain prefix
- `"low_res"` — image URL matches known low-resolution domain patterns (e.g. `*thumb*`, `*mini*`)

#### Scenario: Transparent classification

- GIVEN an image URL ending in `-transparent.png`
- WHEN the mapper processes it
- THEN the system MUST set `image_type = "transparent"`

#### Scenario: Low-resolution classification

- GIVEN an image URL `https://example.com/thumb_123.jpg`
- WHEN the mapper processes it
- THEN the system MUST set `image_type = "low_res"`

#### Scenario: Null image

- GIVEN a product with `image = null`
- WHEN the mapper processes it
- THEN the system MUST set `image_type = null`

### Requirement: Review Step (R13)

`CatalogBuilderForm` MUST include a "Review & Adjust" step between product selection and generation confirmation. This step SHALL display the selected products in a table with columns: name, image thumbnail, image-type badge, and an override selector. The review step MUST offer a price-list control: a checkbox group over the three ERP tiers (`venta`, `taller`, `socio`), of which the user MUST choose at least one and at most two. Every card in the generated catalog MUST print exactly one price row per chosen tier, in the canonical order `venta, taller, socio` regardless of the order chosen. Only users with the `catalogs.generate` action (Administrador) may proceed beyond this step.

Every reviewed product MUST still carry all three resolved tiers through to generation. The choice is a RENDER instruction, not a payload filter: the unchosen tiers' values MUST reach the worker, so the same catalog can be regenerated against a different pair without re-reading the ERP.

#### Scenario: Review table shown

- GIVEN the user has selected all products
- WHEN they click "Review & Adjust"
- THEN the system SHALL show the review table with current image-type per product

#### Scenario: Image type override

- GIVEN a product with `image_type = "opaque"` in the review step
- WHEN the user overrides it to `"transparent"`
- THEN the system MUST use the override value at render time

#### Scenario: No products selected

- GIVEN no products selected
- WHEN the review step is opened
- THEN the system MUST disable "Generate" and show "No products selected"

#### Scenario: Tier control shown with two pre-chosen

- GIVEN the review step renders with candidates selected
- WHEN the Usuario views it
- THEN a checkbox MUST be present for each of Venta, Taller and Socio
- AND Venta and Taller MUST be checked, Socio unchecked

#### Scenario: A third choice is unreachable

- GIVEN two tiers are chosen
- WHEN the Usuario views the remaining checkbox
- THEN that checkbox MUST be disabled rather than accepting the click and
  reporting an error afterwards

#### Scenario: The last choice cannot be removed

- GIVEN exactly one tier is chosen
- WHEN the Usuario views that checkbox
- THEN it MUST be disabled — a card with no price row is not a catalog

#### Scenario: Only the chosen tiers print

- GIVEN Venta and Socio are chosen
- WHEN the catalog renders
- THEN each card MUST show a Venta row and a Socio row and no Taller row at all
- AND the omitted row MUST NOT appear as an em-dash, which states the opposite
  ("we quote that list; this product has no price")

#### Scenario: Chosen tier with no usable price

- GIVEN Taller is chosen and a product's `taller` is `null` or `<= 0`
- WHEN the catalog renders
- THEN that product's Taller row MUST print an em-dash, never `$0.00`

#### Scenario: The first printed row is the headline

- GIVEN Taller and Socio are chosen
- WHEN the catalog renders
- THEN the Taller amount MUST be tinted in the template's primary colour, as
  Venta was when it was always first

#### Scenario: A payload naming no tiers still renders

- GIVEN a `pdf-generate` job enqueued before this change, carrying no `tiers`
- WHEN the worker renders it
- THEN the catalog MUST print Venta and Taller rather than failing the job

#### Scenario: Rejected selections

- GIVEN a generate request whose `tiers` is empty, names three, repeats a tier,
  or names an unknown list
- WHEN the route validates it
- THEN it MUST respond 400 with a `tiers` field error, having re-run the same
  pure validator the client ran

#### Scenario: All three tiers travel to generation

- GIVEN a reviewed product with venta, taller, and socio prices
- WHEN the builder POSTs to `/api/catalog-builder/generate`
- THEN each product entry MUST carry `prices: {venta, taller, socio}`, not a single collapsed `price`

### Requirement: Bulk Rules (R14)

The review step MUST support a bulk "frame all" toggle that sets `image_type = "opaque"` for every product in the current selection, overriding per-product classifications and per-product overrides.

#### Scenario: Frame all enabled

- GIVEN products with mixed image types
- WHEN the user enables "frame all"
- THEN all products MUST use `OpaqueProductCard` in the PDF

#### Scenario: Frame all disabled

- GIVEN "frame all" is enabled
- WHEN the user then disables it
- THEN each product MUST revert to its individual override (or original classification if no override was set)

### Requirement: Catalog Generation Restricted to Administrador

`POST /api/catalog-builder/generate` MUST be gated on the `catalogs.generate` action, which is `false` for `tecnico` and `true` for `administrador` (see `role-permissions`). This is a breaking reduction from today's behavior, where any authenticated user can generate.

#### Scenario: Técnico denied generation

- GIVEN a `tecnico` with a valid session
- WHEN they call `POST /api/catalog-builder/generate`
- THEN the system MUST return `403` and MUST NOT enqueue any generation job

#### Scenario: Administrador unaffected

- GIVEN an `administrador` with a valid session
- WHEN they call `POST /api/catalog-builder/generate`
- THEN the request MUST behave exactly as specified (job enqueues normally)

#### Scenario: Nav item absent for Técnico

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN "Generar Catálogos" MUST be absent (see `app-navigation`)

### Requirement: A Catalog Is A Workshop Asset, Not A Personal Document

Every catalog MUST be listable and downloadable by every role that holds
`catalogs.read`, regardless of who generated it. `catalogs.generate` stays
administrador-only.

Amended 2026-09-15, by the owner's decision, and the amendment closes a
contradiction the earlier wording created rather than merely changing taste.
That wording preserved `catalogs.read`/`catalogs.download` for a `tecnico` while
leaving listing scoped to their own `userId` — and since a `tecnico` cannot
`generate`, they could only ever hold catalogs "generated on their behalf",
which nothing in the product does. Their "Catálogos Generados" screen was empty
by construction and both grants were dead. A catalog is sales material a técnico
shows a customer, so the scoping was the part that was wrong.

#### Scenario: Técnico sees a catalog the Administrador generated

- GIVEN an Administrador has generated a catalog
- WHEN a `tecnico` opens "Catálogos Generados"
- THEN that catalog MUST appear in their list, and MUST be downloadable

#### Scenario: Técnico still cannot generate

- GIVEN a `tecnico`
- WHEN they attempt to reach the catalog builder or `POST /api/catalog-builder/generate`
- THEN it MUST still be refused on `catalogs.generate`

### Requirement: Workshop Contact Block

THE PDF_Generator SHALL render the workshop's contact information — phone, WhatsApp, email, address, hours (single free-text field), website, and any configured social handles — on a dedicated contact page at the end of the catalog, sourced from `workshop_config`. A field left unset by the Administrador MUST simply be omitted from the block, never rendered as an empty label.

#### Scenario: Full contact info

- GIVEN `workshop_config` has phone, email, and two social handles set
- WHEN the catalog's contact page renders
- THEN all three MUST appear, plus any other set fields

#### Scenario: Partial contact info

- GIVEN `workshop_config` has only `phone` set (all other contact fields null)
- WHEN the catalog's contact page renders
- THEN only the phone line MUST appear; no empty placeholders for the unset fields

#### Scenario: No contact information at all

- GIVEN every contact field and `socialHandles` are null
- WHEN the catalog renders
- THEN no contact page MUST be produced at all, rather than a page of empty labels

#### Scenario: Logo matches the live preview

- GIVEN the workshop logo is set via `workshop_config.logoR2Key`
- WHEN the PDF is rendered by the worker (which cannot use the authenticated `/api/workshop-config/logo` route)
- THEN the worker MUST resolve the R2 object server-side and inline it as a `data:` URI so the rendered logo is pixel-identical to the live preview

### Requirement: Seeding the Builder From an Inventory Selection

Staff MUST be able to select products in the inventory list view (per
`table-bulk-actions`) and send that exact selection to the catalog builder,
opening it pre-populated with those products as a second, product-id-based
selection mode alongside the existing category-tree mode. The handoff MUST
carry only the selected product ids; the builder MUST resolve each id's
current product data itself rather than trusting data carried from the list
view, matching how the category-tree mode already resolves products
server-side.

There is deliberately no server-side "select all N matching the current
filter" — building a catalog from a selection larger than one inventory page
still requires ticking rows across each page. This is a known, accepted
limitation; the natural follow-up (a server-side "seleccionar los N que
coinciden con el filtro") is out of scope for this change.

#### Scenarios

- GIVEN 15 products selected across 2 inventory pages
- WHEN staff sends the selection to the catalog builder
- THEN the builder MUST open with exactly those 15 products already selected, in its product-id selection mode

- GIVEN the builder's existing category-tree selection flow
- WHEN a user builds a catalog without ever visiting `/inventory`
- THEN that flow MUST behave exactly as it does today

- GIVEN a handed-off selection containing a product id since removed from inventory
- WHEN the builder resolves the selection
- THEN it MUST drop that id and proceed with the remaining valid products, rather than failing the whole handoff
