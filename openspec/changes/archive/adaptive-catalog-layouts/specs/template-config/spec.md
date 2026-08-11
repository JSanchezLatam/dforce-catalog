# Delta Spec: template-config (adaptive-catalog-layouts)

## MODIFIED Requirements

### Config persistence (R8)

The `template_config` table and `TemplateConfigInput` MUST be extended with a `default_image_handling` field of type `"strict" | "adaptive"`. The validation function `validateTemplateConfigInput` MUST accept and validate this new field. The UI form MUST include a labeled toggle (Select or Switch) for the admin to choose the mode.

#### Scenarios

- GIVEN the admin selects "adaptive" and saves WHEN the config is persisted THEN `default_image_handling` MUST be `"adaptive"`
- GIVEN the admin selects "strict" and saves WHEN the config is persisted THEN `default_image_handling` MUST be `"strict"`
- GIVEN an existing config without `default_image_handling` WHEN `getTemplateConfig` reads it THEN the system MUST default to `"strict"` (backward compatibility)

## ADDED Requirements

### Image handling toggle (R15)

The admin MUST be able to switch between strict and adaptive modes via the `TemplateConfigForm`. When `default_image_handling` is `"strict"`, the PDF pipeline MUST render ALL products using `OpaqueProductCard` regardless of `image_type`. When `"adaptive"`, the PDF pipeline MUST select the card component based on each product's `image_type` classification.

The toggle MUST be persisted to `template_config.default_image_handling` and applied at generation time — not retroactively.

#### Scenarios

- GIVEN `default_image_handling = "strict"` WHEN a catalog is generated THEN all products MUST use `OpaqueProductCard` even if `image_type = "transparent"`
- GIVEN `default_image_handling = "adaptive"` WHEN a catalog is generated THEN each product MUST use the card component matching its `image_type`
- GIVEN the admin changes from "adaptive" to "strict" WHEN an existing catalog was generated with "adaptive" THEN the existing catalog MUST NOT be re-rendered
