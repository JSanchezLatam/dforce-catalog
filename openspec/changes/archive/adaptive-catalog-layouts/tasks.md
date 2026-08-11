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
- [x] 5.2 **Done.** The original blocker ("no jsdom harness exists") died with the `component-testing-infra` work — `vitest.config.ts` now has a `jsdom` project. Closed with two test files, because the task's own premise was wrong in a second way:
  - **`selection.test.ts` — `toggleBulkFrame` (6 tests).** The bulk frame/restore rule from 3.1 was never testable through `ProductLayoutTuner` at all: that component is presentational and owns none of this state. The transition was an inline arrow inside `CatalogBuilderForm.tsx`, so it was extracted into `selection.ts` as a pure function and the form now calls it. Pins snapshot-on-enter, exact restore-on-exit, lossless round-trip, and no mutation of the caller's state.
  - **`ProductLayoutTuner.test.tsx` (jsdom, 10 tests).** Covers what this component genuinely decides: the classified badge gives way to an `Override:` badge (never both), an unclassified product gets no badge, a product with no image gets the placeholder, the bulk button's label flips to signal that toggling again restores, and the `__auto__` sentinel is emitted to the parent as `null` rather than as the literal string.
- [x] 5.3 `render.test.ts` covers strict mode forcing `OpaqueProductCard` regardless of `imageType`.
- [x] 5.4 163/163 tests passing (162 from the original PR3 commit + 1 new regression test for the zero-products guard). At close: 632/632 across the whole suite.

## Change status: COMPLETE

All 19 tasks done. Closed on 2026-08-11, after `component-testing-infra` removed 5.2's blocker. Two corrections landed with the close:

- **`toggleBulkFrame` extracted from `CatalogBuilderForm.tsx` into `selection.ts`.** Not a refactor for taste — the rule 3.1 fixed lived in an inline JSX arrow, which is why 5.2 could never have covered it from the component it named.
- **`design.md`'s NULL-fallback line was wrong** and is now marked with an erratum. It said NULL → `'adaptive'`; the shipped code does NULL → `'strict'`. The code is correct: adaptive-on-NULL would have silently restyled every pre-existing catalog on deploy.

## Key estimates

| Phase | Lines | Files |
|-------|-------|-------|
| Schema + Sync | ~110 | 4 |
| Pipeline + Cards | ~240 | 4 |
| UI Review Step | ~260 | 3 |
| Admin Toggle | ~50 | 2 |
| Tests | ~120 | 2 |
| **Total** | **~780** | **14** (12 modified + 2 new) |
