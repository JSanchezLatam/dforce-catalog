# Proposal: adaptive-catalog-layouts

## Intent
Extend the catalog PDF generation to support adaptive layouts based on product image quality (transparent/opaque/low_res), so catalogs look professional regardless of image inconsistency.

## Scope

### In Scope
- Add `image_type` column to `producto` table (transparent/opaque/low_res)
- Add `default_image_handling` to `template_config` (strict/adaptive)
- Heuristic image classification in inventory-sync mapper
- Multi-step UI: new "Review & Adjust" step in CatalogBuilderForm
- ProductLayoutTuner component for per-product image type overrides + bulk rules
- TransparentProductCard (full-bleed) + OpaqueProductCard (polaroid) in CatalogTemplate
- Extend ProductPrintRef with image + imageType for pipeline
- Admin toggle in TemplateConfigForm

### Out of Scope
- Pixel-level image analysis (server-side PNG analysis)
- Image upload/editing within the app
- Retroactive re-render of existing catalogs
- Per-catalog image type override (only per-product + global)

## Capabilities

### Modified Capabilities
- `catalog-generation`: Product selection payload now includes image classification; template renders conditionally; new review step before generation
- `template-config`: New `default_image_handling` field and UI toggle

## Approach
1. Add image_type enum to schema, classify during sync via heuristic
2. Extend ProductPrintRef → PdfGeneratePayload → worker with image data
3. Insert Review step in CatalogBuilderForm client state (step flag)
4. Refactor CatalogTemplate with conditional card components
5. Inline PDF CSS for the two card variants (Tailwind not available in Playwright HTML)
6. Add default_image_handling select to TemplateConfigForm

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| shared/db/schema.ts | Modified | +image_type enum on producto, +default_image_handling enum on template_config |
| modules/inventory-sync/mapper.ts | Modified | Heuristic classification, output +image_type |
| modules/inventory-sync/job.ts | Modified | Upsert includes image_type |
| modules/catalog-builder/selection.ts | Modified | ProductRef +imageType field; validation +image_type rules |
| modules/catalog-builder/queries.ts | Modified | SELECT includes image_type from raw |
| modules/catalog-builder/CatalogBuilderForm.tsx | Modified | Multi-step flow; ProductLayoutTuner integration |
| modules/catalog-builder/ProductLayoutTuner.tsx | New | Per-product + bulk image type override UI |
| shared/template/CatalogTemplate.tsx | Modified | Conditional TransparentProductCard / OpaqueProductCard |
| shared/template/AdaptiveCards.tsx | New | Card components with polaroid/full-bleed styles |
| modules/pdf-generation/enqueue.ts | Modified | PdfGeneratePayload products include image + imageType |
| modules/pdf-generation/render.ts | Modified | Inline card CSS in generated HTML |
| modules/template-config/service.ts | Modified | Validate + persist default_image_handling |
| modules/template-config/TemplateConfigForm.tsx | Modified | +Select for default_image_handling |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tailwind classes don't work in Playwright HTML | High | Inline all CSS in render.ts <style> block |
| Heuristic misclassifies images | Medium | Per-product override in ProductLayoutTuner |
| pg-boss payload grows with image URLs | Low | Max 200 products, ~30KB extra, JSONB handles it |
| Existing catalogs don't get adaptive layout | Low | Intentional — only new catalogs use adaptive |

## Rollback Plan
- Revert schema migration (drizzle-kit down)
- Revert CatalogTemplate to previous version
- Revert CatalogBuilderForm to single-step flow
- Revert template-config service + form

## Success Criteria
- [ ] image_type is populated for all synced products
- [ ] Admin can toggle strict/adaptive in template-config
- [ ] User sees review step with image type indicators before generating
- [ ] PDF renders transparent images full-bleed and opaque images with polaroid frame
- [ ] All 115+ existing tests pass unchanged
