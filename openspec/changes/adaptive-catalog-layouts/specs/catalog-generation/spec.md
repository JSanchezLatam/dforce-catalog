# Delta Spec: catalog-generation (adaptive-catalog-layouts)

## MODIFIED Requirements

### Selection (R5)

The selection flow MUST carry `image` and `image_type` alongside each product from the moment candidates are loaded. The `ProductRef` type MUST include `image?: string | null` and `imageType?: "transparent" | "opaque" | "low_res"`. Before enqueuing generation, the system MUST present a review step where the user inspects per-product image types.

#### Scenarios

- GIVEN products with mixed image types WHEN the user opens the review step THEN the system SHALL display an image-type indicator (transparent/opaque/low_res) per product row
- GIVEN a product with `image_type = null` WHEN the review step renders THEN the system SHALL display "unknown" as the image-type indicator
- GIVEN a low-resolution product image WHEN the user reviews the selection THEN the system MUST NOT block generation — the indicator is advisory, not gating

### Generation (R6)

The `ProductPrintRef` type MUST be extended with `image?: string | null` and `imageType?: "transparent" | "opaque" | "low_res"`. The `PdfGeneratePayload` MUST carry these fields so the worker has image data at render time.

#### Scenarios

- GIVEN a product with `imageType = "transparent"` WHEN the PDF is rendered THEN the system MUST use `TransparentProductCard` (full-bleed image, no frame)
- GIVEN a product with `imageType = "opaque"` or `"low_res"` WHEN the PDF is rendered THEN the system MUST use `OpaqueProductCard` (polaroid frame with white border)
- GIVEN a product with `image = null` WHEN the PDF is rendered THEN the system MUST use `OpaqueProductCard` with a placeholder

## ADDED Requirements

### Image Classification (R12)

The inventory-sync mapper MUST classify each product's image at sync time via client-side heuristic and persist `image_type` in the `producto` table.

.Criteria — a product image MUST be classified as:
- `"transparent"` — image URL ends with `.png` and common transparent-domain prefixes (e.g. `*-transparent`, `*-sin-fondo`)
- `"opaque"` — image URL ends with `.jpg`, `.jpeg`, `.webp`, or any PNG without transparent-domain prefix
- `"low_res"` — image URL matches known low-resolution domain patterns (e.g. `*thumb*`, `*mini*`)

#### Scenarios

- GIVEN an image URL ending in `-transparent.png` WHEN the mapper processes it THEN the system MUST set `image_type = "transparent"`
- GIVEN an image URL `https://example.com/thumb_123.jpg` WHEN the mapper processes it THEN the system MUST set `image_type = "low_res"`
- GIVEN an image URL with `image = null` WHEN the mapper processes it THEN the system MUST set `image_type = null`

### Review Step (R13)

`CatalogBuilderForm` MUST include a "Review & Adjust" step between product selection and generation confirmation. This step SHALL display the selected products in a table with columns: name, image thumbnail, image-type badge, and an override selector.

#### Scenarios

- GIVEN the user has selected all products WHEN they click "Review & Adjust" THEN the system SHALL show the review table with current image-type per product
- GIVEN a product with `image_type = "opaque"` in the review step WHEN the user overrides it to `"transparent"` THEN the system MUST use the override value at render time
- GIVEN no products selected WHEN the review step is opened THEN the system MUST disable "Generate" and show "No products selected"

### Bulk Rules (R14)

The review step MUST support a bulk "frame all" toggle that sets `image_type = "opaque"` for every product in the current selection, overriding per-product classifications and per-product overrides.

#### Scenarios

- GIVEN products with mixed image types WHEN the user enables "frame all" THEN all products MUST use `OpaqueProductCard` in the PDF
- GIVEN "frame all" is enabled WHEN the user then disables it THEN each product MUST revert to its individual override (or original classification if no override was set)
