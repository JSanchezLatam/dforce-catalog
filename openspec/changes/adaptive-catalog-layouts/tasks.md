# Tasks: adaptive-catalog-layouts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~780 |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Schema + Sync) → PR 2 (Pipeline + Cards) → PR 3 (UI + Admin + Tests) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + Sync classification | PR 1 | ~110 lines: 14 files reviewed |
| 2 | Pipeline extension + card components | PR 2 | ~240 lines: extends types through entire generation path |
| 3 | UI review step + admin toggle + tests | PR 3 | ~430 lines: new component, form changes, full test suite |

## Phase 1: Schema + Sync ✅

- [x] 1.1 `shared/db/schema.ts` — add `image_type` text column (nullable) to `producto`, add `default_image_handling` text column (nullable, default null) to `template_config`. Generate migration file.
- [x] 1.2 `modules/inventory-sync/mapper.ts` — add `classifyImageType(product: RawProduct): "transparent" | "opaque" | "low_res" | null` heuristic function. Logic: no Images array or empty → `low_res`; URL includes `.png` and transparent-domain prefix → `transparent`; URL includes `thumb` or `mini` → `low_res`; default → `opaque`.
- [x] 1.3 `modules/inventory-sync/job.ts` — include `image_type` in upsert payload.
- [x] 1.4 `modules/inventory-sync/mapper.test.ts` — test heuristic: png+transparent prefix → `transparent`, jpg → `opaque`, null Images → `low_res`, thumb URL → `low_res`.

## Phase 2: Pipeline + Card Components ✅

- [x] 2.1 `modules/catalog-builder/selection.ts` — extend `ProductRef` with optional `imageType` field.
- [x] 2.2 `modules/catalog-builder/queries.ts` — `SELECT` includes `image_type` from raw product data.
- [x] 2.3 `shared/template/AdaptiveCards.tsx` — new file: `TransparentProductCard` + `OpaqueProductCard`.
- [x] 2.4 `shared/template/CatalogTemplate.tsx` — extend `ProductPrintRef` with `image`/`imageType`. Add `defaultImageHandling` prop. Conditional rendering: strict→OpaqueProductCard; adaptive→selects by imageType.
- [x] 2.5 `modules/pdf-generation/enqueue.ts` — `PdfGeneratePayload` already uses `ProductPrintRef`, gets new fields automatically.
- [x] 2.6 `modules/pdf-generation/render.ts` — inline card CSS in `<style>` block. Props pass `defaultImageHandling`.

## Phase 3: UI — Review Step

- [x] 3.1 `modules/catalog-builder/ProductLayoutTuner.tsx` — product grid with columns (name, image thumbnail, image-type badge, override selector dropdown). Per-product override dropdown works. Bulk "frame all" toggle was initially one-way (always forced opaque, never restored prior per-product overrides on toggle-off) — fixed via an explicit `bulkFramed` state + a snapshot ref of the pre-bulk overrides, restored on toggle-off.
- [x] 3.2 `modules/catalog-builder/CatalogBuilderForm.tsx` — implemented as a 2-state machine (`"select" | "review"`) with "Generate" opening a confirm dialog, rather than the literal 3rd `"generate"` step originally described — functionally equivalent (same select → review & adjust → confirm generate flow), noted as a deviation from the literal task wording, not a bug. "Generate" is now disabled with a "No products selected" message when the review step has zero products (was previously not gated at all).
- [x] 3.3 `app/api/catalog-builder/generate/route.ts` — accepts reviewed products with `image`/`imageType` fields, passes them through to the enqueue payload.

## Phase 4: Admin Toggle

- [x] 4.1 `modules/template-config/service.ts` validates `"strict"`/`"adaptive"` and persists the field. The "default to strict for backward compat" fallback actually lives in `shared/template/CatalogTemplate.tsx` (`defaultImageHandling ?? "strict"` at render time) rather than in `service.ts` as this task originally specified — works correctly end-to-end, but note `design.md` describes the opposite fallback (null → adaptive), which is an internal documentation inconsistency worth reconciling, not a functional bug.
- [x] 4.2 `modules/template-config/TemplateConfigForm.tsx` — `<Select>` with the specified labels.

## Phase 5: Tests

- [x] 5.1 `pdf-generation/render.test.ts` covers adaptive card selection by `imageType`.
- [ ] 5.2 **Still missing.** No test file exists for `ProductLayoutTuner.tsx` — the project's Vitest setup (`vitest.config.ts`) runs in a `node` environment with no `@testing-library/react`/jsdom/happy-dom, so component-level tests aren't supported yet. Added a regression test for the zero-products validation at the `validateCatalogSelection` level instead (`selection.test.ts`), which covers the "no products disables generate" rule that actually matters end-to-end, but the bulk "frame all" restore behavior (fixed in 3.1) still has no automated regression test. Adding one requires first adding a component-testing harness to the project.
- [x] 5.3 `render.test.ts` covers strict mode forcing `OpaqueProductCard` regardless of `imageType`.
- [x] 5.4 163/163 tests passing (162 from the original PR3 commit + 1 new regression test for the zero-products guard).

## Key estimates

| Phase | Lines | Files |
|-------|-------|-------|
| Schema + Sync | ~110 | 4 |
| Pipeline + Cards | ~240 | 4 |
| UI Review Step | ~260 | 3 |
| Admin Toggle | ~50 | 2 |
| Tests | ~120 | 2 |
| **Total** | **~780** | **14** (12 modified + 2 new) |
