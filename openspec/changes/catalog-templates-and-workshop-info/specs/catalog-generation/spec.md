# Delta Spec: catalog-generation (catalog-templates-and-workshop-info)

Additive/modifying on top of `adaptive-catalog-layouts` and
`crm-shell-settings-rbac`'s deltas (see `openspec/specs/catalog-generation`
once consolidated).

## MODIFIED Requirements

### Requirement: Review Step (R13)

`CatalogBuilderForm`'s review step MUST NOT offer a price-tier selector.
Every reviewed product MUST carry all three resolved tiers (`venta`,
`taller`, `socio`) through to generation, instead of collapsing to one
admin-chosen list before the "Generate" step.
(Previously: the review step showed a "Lista de precios" `Select` letting
the user pick exactly one tier; only that tier reached the PDF.)

#### Scenario: No tier selector shown

- GIVEN the review step renders with candidates selected
- WHEN the Usuario views it
- THEN no "Lista de precios" control MUST be present

#### Scenario: All three tiers travel to generation

- GIVEN a reviewed product with venta, taller, and socio prices
- WHEN the builder POSTs to `/api/catalog-builder/generate`
- THEN each product entry MUST carry `prices: {venta, taller, socio}`, not a
  single collapsed `price`

### Requirement: PDF Catalog Generation (R6)

WHEN the Usuario confirms generation, THE PDF_Generator SHALL produce a PDF
with cover, dynamic index, and product pages for the selected categories,
applying the branding of the template selected in `template-config` and the
workshop's cover text (see `workshop-settings`). Every product card SHALL
show all three price tiers (Venta, Taller, Socio) in bold; a tier with no
usable price — absent from the payload, or an ERP value `<= 0.00` — SHALL
render an em-dash (`—`), never `$0.00` and never a blank line. All other R6
behavior (progress indicator, error handling preserving the user's
selection, Playwright/Puppeteer rendering) is unchanged.
(Previously: each card showed exactly one bold price, or nothing at all when
that single tier had no usable price.)

#### Scenario: All three tiers present

- GIVEN a product with venta=120.00, taller=100.00, socio=90.00
- WHEN its card renders
- THEN all three prices MUST appear, each bold, labeled Venta/Taller/Socio

#### Scenario: A zero tier renders an em-dash

- GIVEN a real product where `socio = 0.00` (verified present in production
  data)
- WHEN its card renders
- THEN the Socio line MUST show `—`, never `$0.00`, while Venta and Taller
  still show their bold prices

#### Scenario: A missing tier renders an em-dash

- GIVEN a product whose payload omits the `taller` field entirely
- WHEN its card renders
- THEN the Taller line MUST show `—`, exactly as the zero-value case

## ADDED Requirements

### Requirement: Workshop Contact Block on Cover

THE PDF_Generator SHALL render the workshop's contact information — phone,
WhatsApp, email, address, hours (single free-text field), website, and any
configured social handles — on the catalog cover, sourced from
`workshop_config`. A field left unset by the Administrador MUST simply be
omitted from the block, never rendered as an empty label.

#### Scenario: Full contact info

- GIVEN `workshop_config` has phone, email, and two social handles set
- WHEN a catalog cover renders
- THEN all three MUST appear on the cover, plus any other set fields

#### Scenario: Partial contact info

- GIVEN `workshop_config` has only `phone` set (all other contact fields
  null)
- WHEN a catalog cover renders
- THEN only the phone line MUST appear; no empty placeholders for the
  unset fields

#### Scenario: Logo matches the live preview

- GIVEN the workshop logo is set via `workshop_config.logoR2Key`
- WHEN the PDF is rendered by the worker (which cannot use the authenticated
  `/api/workshop-config/logo` route)
- THEN the worker MUST resolve the R2 object server-side and inline it as a
  `data:` URI so the rendered logo is pixel-identical to the live preview
