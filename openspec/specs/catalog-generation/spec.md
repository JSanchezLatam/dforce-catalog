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

The `ProductPrintRef` type MUST be extended with `image?: string | null` and `imageType?: "transparent" | "opaque" | "low_res"`, and with `prices?: {venta, taller, socio}` (all `number | null`). The PDF MUST apply the branding of the template selected in `template-config` (font and colors from the registry) and the workshop's cover text and contact information from `workshop-settings`. Every product card SHALL show all three price tiers (Venta, Taller, Socio) in bold; a tier with no usable price — absent from the payload, or an ERP value `<= 0.00` — SHALL render an em-dash (`—`), never `$0.00` and never a blank line. Image cards are rendered according to their image type (transparent → full-bleed, opaque/low_res → polaroid frame).

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

#### Scenario: All three tiers present

- GIVEN a product with venta=120.00, taller=100.00, socio=90.00
- WHEN its card renders
- THEN all three prices MUST appear, each bold, labeled Venta/Taller/Socio

#### Scenario: A zero tier renders an em-dash

- GIVEN a real product where `socio = 0.00` (verified present in production data)
- WHEN its card renders
- THEN the Socio line MUST show `—`, never `$0.00`, while Venta and Taller still show their bold prices

#### Scenario: A missing tier renders an em-dash

- GIVEN a product whose payload omits the `taller` field entirely
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

`CatalogBuilderForm` MUST include a "Review & Adjust" step between product selection and generation confirmation. This step SHALL display the selected products in a table with columns: name, image thumbnail, image-type badge, and an override selector. The review step MUST NOT offer a price-tier selector; every reviewed product MUST carry all three resolved tiers (`venta`, `taller`, `socio`) through to generation. Only users with the `catalogs.generate` action (Administrador) may proceed beyond this step.

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

#### Scenario: No tier selector shown

- GIVEN the review step renders with candidates selected
- WHEN the Usuario views it
- THEN no "Lista de precios" control MUST be present

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

### Requirement: Pre-Existing Catalogs Remain Listable

Restricting `catalogs.generate` MUST NOT affect `catalogs.read`/`catalogs.download` or ownership logic. A `tecnico`'s catalogs generated before this change (or generated on their behalf) MUST remain listable and downloadable exactly as today — ownership/listing logic is untouched by this change.

#### Scenario: Pre-existing catalog still listed

- GIVEN a `tecnico` who generated catalogs before this change shipped
- WHEN they open "Catálogos Generados"
- THEN their existing catalogs MUST still appear in the list, unchanged

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
