# Catalog Generation Specification

## Purpose

Governs how a Usuario selects categories/products, reviews them, and
generates a branded PDF catalog with per-product pricing and workshop
contact info.

## Built From

Consolidated 2026-08-12 (first read of this capability; see
`openspec/changes/archive/README.md`).

1. `.kiro/specs/dforce-catalog/requirements.md` — Requisito 5 (selection),
   Requisito 6 (generation)
2. `openspec/changes/archive/adaptive-catalog-layouts/specs/catalog-generation/spec.md`
   — image classification, review step, adaptive card selection
3. `openspec/changes/archive/crm-shell-settings-rbac/specs/catalog-generation/spec.md`
   — RBAC gating on generation
4. `openspec/changes/catalog-templates-and-workshop-info/specs/catalog-generation/spec.md`
   — three-tier pricing, workshop contact block, tier-selector retired

Next reader: this is the FULL current state after applying all four in
order — no further two-source read is needed for `catalog-generation`.

## Requirements

### Requirement: Category and Product Selection (R5)

`Catalog_Builder` SHALL let the Usuario select one or more Category_L1/L2,
exclude specific categories or products, and configure products-per-page
(1-20). The title and index preview SHALL update in real time as the
selection changes. Generation MUST be blocked with an error when no category
is selected, or when the total selected products exceed 200. Each candidate
carries `image` and `image_type` from the moment it loads.

#### Scenario: Real-time title update

- GIVEN the Usuario has an empty selection
- WHEN they select a Category_L1
- THEN the catalog title MUST update immediately to reflect it

#### Scenario: Over-limit selection blocked

- GIVEN a selection totaling more than 200 products
- WHEN the Usuario attempts to generate
- THEN the system MUST show an error with the current total and refuse to
  proceed

### Requirement: Review Step (R13)

`CatalogBuilderForm` MUST include a "Review & Adjust" step between selection
and generation, showing name, image thumbnail, image-type badge, and an
override selector per product. It MUST NOT offer a price-tier selector —
every reviewed product carries all three resolved tiers (`venta`, `taller`,
`socio`) through to generation.

#### Scenario: Review table shows current classification

- GIVEN the Usuario has selected products
- WHEN they open "Review & Adjust"
- THEN the table MUST show each product's current image-type

#### Scenario: No tier selector

- GIVEN the review step renders
- WHEN the Usuario views it
- THEN no price-tier control MUST be present; all three tiers travel to
  generation automatically

### Requirement: Bulk Rules (R14)

The review step MUST support a "frame all" toggle forcing `OpaqueProductCard`
for every product, overriding per-product classifications/overrides;
disabling it MUST restore each product's prior override or classification.

#### Scenario: Frame-all overrides everything

- GIVEN mixed image types
- WHEN "frame all" is enabled
- THEN every product MUST render with `OpaqueProductCard`

### Requirement: Image Classification (R12)

The inventory-sync mapper SHALL classify each product's image at sync time
(`transparent`, `opaque`, `low_res`, or `null`) and persist it on `producto`.

#### Scenario: Transparent-domain PNG classified

- GIVEN an image URL ending in `-transparent.png`
- WHEN the mapper processes it
- THEN `image_type` MUST be `"transparent"`

### Requirement: PDF Catalog Generation (R6)

WHEN the Usuario confirms generation, THE PDF_Generator SHALL produce a PDF
with cover, dynamic index, and product pages for the selected categories,
applying the branding of the template selected in `template-config` and the
workshop's cover text (see `workshop-settings`). Every product card SHALL
show all three price tiers (Venta, Taller, Socio) in bold; a tier with no
usable price — absent from the payload, or an ERP value `<= 0.00` — SHALL
render an em-dash (`—`), never `$0.00`. THE Sistema SHALL show a progress
indicator while generating, notify the Usuario on success with immediate
download, and on error preserve the Usuario's selection for retry.
`image_type = "transparent"` products render via `TransparentProductCard`;
all others via `OpaqueProductCard`, per `defaultImageHandling` (see
`template-config`). Rendering happens via Playwright/Puppeteer server-side.

#### Scenario: All three tiers present

- GIVEN a product with venta=120.00, taller=100.00, socio=90.00
- WHEN its card renders
- THEN all three prices MUST appear, each bold, labeled Venta/Taller/Socio

#### Scenario: A zero tier renders an em-dash

- GIVEN a real product where `socio = 0.00`
- WHEN its card renders
- THEN the Socio line MUST show `—`, never `$0.00`, while Venta and Taller
  still show their bold prices

#### Scenario: A missing tier renders an em-dash

- GIVEN a product whose payload omits the `taller` field entirely
- WHEN its card renders
- THEN the Taller line MUST show `—`, exactly as the zero-value case

### Requirement: Workshop Contact Block on Cover

THE PDF_Generator SHALL render the workshop's contact information — phone,
WhatsApp, email, address, hours, website, and any configured social handles
— on the catalog cover, sourced from `workshop_config`. An unset field MUST
be omitted, never rendered as an empty label.

#### Scenario: Partial contact info

- GIVEN `workshop_config` has only `phone` set
- WHEN a catalog cover renders
- THEN only the phone line MUST appear

#### Scenario: Logo matches the live preview

- GIVEN the workshop logo is set via `workshop_config.logoR2Key`
- WHEN the PDF is rendered by the worker
- THEN it MUST resolve the R2 object server-side and inline it as a `data:`
  URI so the rendered logo is pixel-identical to the live preview

### Requirement: Catalog Generation Restricted to Administrador

`POST /api/catalog-builder/generate` MUST be gated on the
`catalogs.generate` action (`false` for `tecnico`, `true` for
`administrador`).

#### Scenario: Técnico denied generation

- GIVEN a `tecnico` with a valid session
- WHEN they call the generate endpoint
- THEN the system MUST return `403` and enqueue no job

### Requirement: Técnico's Pre-Existing Catalogs Remain Listable

Restricting `catalogs.generate` MUST NOT affect `catalogs.read`/`download`
or ownership logic.

#### Scenario: Pre-existing catalog still listed

- GIVEN a `tecnico` who generated catalogs before RBAC restricted generation
- WHEN they open "Catálogos Generados"
- THEN their existing catalogs MUST still appear, unchanged
