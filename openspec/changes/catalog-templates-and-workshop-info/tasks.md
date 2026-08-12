# Tasks: Catalog Templates and Workshop Info

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100–1,360 (4 chained slices) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 → WU4 |
| Delivery strategy | auto-chain |
| Chain strategy | `feature-branch-chain` — confirmed by the owner while this phase was running |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain

A tracker branch `feature/catalog-templates-and-workshop-info` holds the change. WU1
targets the tracker; each later WU targets the previous WU's branch; only the tracker
merges to `main`. Chosen because migrations 0008 and 0009 create an intermediate state —
new columns added, old `template_config` branding columns still present and `NOT NULL` —
that must never sit on `main`. Same topology as the archived `user-lifecycle-management`.
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| WU1 | Workshop contact fields + `coverText` + migration `0008` | PR 1 | `vitest run src/modules/workshop-config` | Live smoke: real Postgres, migrate then read/write the singleton row | `workshop_config` columns are nullable/additive; revert is pure code + one down-migration |
| WU2 | Template registry + gallery picker (additive, unwired) | PR 2 | `vitest run src/shared/template/registry.test.ts src/modules/template-config` | N/A — no DB/subprocess/browser touched; registry is pure code | Registry files + `selectedTemplateId` column are dead until WU3 wires them; delete the picker, form still works |
| WU3 | Wire registry into renderer; branding split; logo data URI; migration `0009` | PR 3 | `vitest run src/shared/template src/modules/pdf-generation` | Live smoke: generate one real PDF, compare logo pixel-for-pixel against the live preview | One-way after `0009` merges (column drop); revert before merge is pure code |
| WU4 | Three-tier pricing incl. `AdaptiveCards.test.tsx` + e2e | PR 4 | `vitest run src/shared/template/AdaptiveCards.test.tsx src/app/api/catalog-builder/generate` | Live smoke: `src/e2e/full-flow.e2e.test.ts` against real Postgres + Chromium | Independent commit; revert restores scalar `price` end to end |

Est. lines: WU1 ~220, WU2 ~280, WU3 ~340 (Medium→High per new logo-URI work), WU4 ~400 (High, `size:exception` candidate — see design.md, do not split the `price`→`prices` rename).

Sequential dependency: WU2 needs `0008`'s `selected_template_id` column (WU1). WU3 needs WU2's registry and drops the branding columns WU2's picker still writes placeholders into. WU4 shares `CatalogBuilderForm.tsx`/`generate/route.ts` with WU3 (branding assembly) — land after WU3 to avoid a two-way merge on the same functions, though WU4's price-shape work is otherwise independent of branding.

## Phase 1 — WU1: Workshop Contact Info + `coverText`

Files: `src/shared/db/schema.ts`, `src/shared/db/migrations/0008_*.sql` (+`meta/`), `src/modules/workshop-config/service.ts`(+test), `src/modules/workshop-config/WorkshopConfigForm.tsx`(+test), `src/app/api/workshop-config/route.ts`(+test).

- [x] 1.1 Add `phone, whatsapp, email, address, hours, website, coverText` (nullable text) + `socialHandles` (jsonb) to `workshopConfig` in `schema.ts`.
- [x] 1.2 Generate migration `0008_*` (drizzle-kit): new nullable columns above, `templateConfig.selectedTemplateId` (nullable text), and hand-append `UPDATE workshop_config SET cover_text = (SELECT cover_text FROM template_config LIMIT 1) WHERE cover_text IS NULL`.
- [x] 1.3 RED `service.test.ts` — `validateWorkshopConfigInput` accepts each new field independently; `socialHandles` accepts an arbitrary platform key with no schema change.
- [x] 1.4 GREEN `service.ts` — extend `WorkshopConfigInput` + the `"field" in value` / `"field" in parsed` partial-touch checks (mirrors existing `logoR2Key` pattern) for all 8 new fields.
- [x] 1.5 RED `service.test.ts` — partial update of one field (e.g. `phone`) leaves `email` and every other already-set field unchanged (spec: "Partial update preserves other fields").
- [x] 1.6 GREEN — confirm 1.4's insert/update-set builders satisfy 1.5 (no new logic expected if the pattern is followed correctly).
- [x] 1.7 RED `WorkshopConfigForm.test.tsx` — new inputs render and submit; `hours` is one free-text field with no per-day parsing.
- [x] 1.8 GREEN `WorkshopConfigForm.tsx` — add contact fields + `coverText` textarea + social-handle key/value rows.
- [x] 1.9 Update `route.ts`/`route.test.ts` if request-body shape assertions need the new fields. (Not needed: `route.ts` passes the raw body straight through to `saveWorkshopConfig`, already covered by `service.test.ts`.)
- [x] 1.10 Live smoke: run migration `0008` against real Postgres; confirm the existing singleton row's `cover_text` was hand-copied from `template_config` and every new column defaults to `NULL`.

## Phase 2 — WU2: Template Registry + Gallery Picker

Files: `src/shared/template/registry.ts`(new), `src/shared/template/templates/dforce-classic.tsx`(new), `src/shared/template/registry.test.ts`(new), `src/modules/template-config/service.ts`(+test), `src/modules/template-config/TemplateConfigForm.tsx`(+test).

- [x] 2.1 RED `registry.test.ts` — `getTemplate(unknownId)` and `getTemplate(null)` both return the entry matching `DEFAULT_TEMPLATE_ID`; `CATALOG_TEMPLATES` ids are unique.
- [x] 2.2 GREEN `registry.ts` — `CatalogTemplateDef` type, `CATALOG_TEMPLATES`, `DEFAULT_TEMPLATE_ID`, `getTemplate()` per design D1.
- [x] 2.3 GREEN `templates/dforce-classic.tsx` — hand-translated from `Template_Catalogo.op` mockup: `font`, `primaryColors`, `thumbnail`, and a `Card` component (today's `pickCard` strict/adaptive branch moves in here, still wrapping `AdaptiveCards`).
- [x] 2.4 RED `service.test.ts` — `validateTemplateConfigInput` accepts `selectedTemplateId`; still requires `logoUrl`/`primaryColors`/`font`/`coverText` (columns are still `NOT NULL` until `0009`).
- [x] 2.5 GREEN `service.ts` — `saveTemplateConfig` accepts `selectedTemplateId` alongside the still-required four legacy `NOT NULL` fields (deviation — see apply-progress.md: the WU2 execution prompt corrected design Risk #3's "no longer form inputs" framing; the picker EXTENDS the branding form instead of replacing it, so no placeholder synthesis was needed).
- [x] 2.6 RED `TemplateConfigForm.test.tsx` — gallery renders exactly the one registry entry, pre-selected; the legacy branding inputs still render alongside it (deviation from the literal "no color/font/logo/cover-text input present" wording — see apply-progress.md).
- [x] 2.7 GREEN `TemplateConfigForm.tsx` — add a gallery picker over `CATALOG_TEMPLATES` alongside the existing branding inputs; on save, POST includes `selectedTemplateId`.
- [x] 2.8 RED `service.test.ts` — saved `selectedTemplateId` round-trips through `getTemplateConfig()` (spec: "Selection survives a restart").

## Phase 3 — WU3: Wire Registry Into Renderer; Branding Split; Logo Data URI; Migration `0009`

Files: `src/shared/template/CatalogTemplate.tsx`, `src/modules/pdf-generation/{enqueue,worker,render}.ts`(+tests), `src/app/api/catalog-builder/generate/route.ts`(+test), `src/modules/catalog-builder/CatalogBuilderForm.tsx`, `src/app/(app)/builder/page.tsx`, `src/shared/db/schema.ts`, `src/shared/db/migrations/0009_*.sql`.

- [x] 3.1 RED `render.test.ts` (existing render test, not a new `CatalogTemplate.test.tsx` — `CatalogTemplate` is a plain function component already exercised via `renderToStaticMarkup` in `render.ts`, so no jsdom file was needed) — `CatalogTemplateBranding` shrinks to `{templateId, logoUrl, coverText}`; `CatalogTemplate` resolves font/colors via `getTemplate(branding.templateId)`, not `branding.font`/`branding.primaryColors`.
- [x] 3.2 GREEN `CatalogTemplate.tsx` — shrunk `CatalogTemplateBranding`; calls `getTemplate()`; delegates card rendering to `template.Card` (removed the duplicated `pickCard` branch, moved to `dforce-classic.tsx` in WU2).
- [x] 3.3 RED `render.test.ts` — PDF body `font-family` resolves from `getTemplate(branding.templateId)`, not `branding.font` (closes design's New Risk #1).
- [x] 3.4 GREEN `render.ts` — `renderCatalogHtml` calls `getTemplate()` for the body font.
- [x] 3.5 Added `PdfBranding` type to `enqueue.ts`: `{templateId, logoR2Key, logoContentType, coverText}`; changed `PdfGeneratePayload.branding` to `PdfBranding | null`.
- [x] 3.6 RED `worker.test.ts` — DEVIATION: tests a new exported `resolveBranding(branding, deps)` seam, not `renderPdfBuffer` directly. `renderPdfBuffer` launches real Playwright Chromium and design.md's own Testing Strategy table says it "has no unit coverage by design — the data-URI path is verifiable only live." Extracting the resolution logic into its own injectable-dep function (this repo's standing `deps?.thing ?? real` seam) gives the actual crux of this work unit — the R2-to-data-URI resolution — real unit coverage without mocking Playwright, while `renderPdfBuffer` itself stays live-smoke-only as designed. Covers: resolves `logoR2Key` via `getObject()` into a `data:` URI; `getObject()` returning `null` yields `logoUrl: null` without throwing; no `logoR2Key` skips the `getObject()` call entirely.
- [x] 3.7 GREEN `worker.ts` — `resolveBranding()` implements D3; `renderPdfBuffer` calls it before `renderCatalogHtml`.
- [x] 3.8 RED `generate/route.test.ts` — branding assembly builds `PdfBranding` from `getWorkshopConfig()` (`logoR2Key`, `logoContentType`, `coverText`) + `getTemplateConfig()` (`selectedTemplateId`), not the old four-field object; includes a case for a non-null, all-null-fields workshop config row.
- [x] 3.9 GREEN `generate/route.ts` — reads `getWorkshopConfig()` alongside `getTemplateConfig()`; assembles `PdfBranding` via `getTemplate(template?.selectedTemplateId).id` (never sends `branding: null` — every field is independently nullable already, so there is no remaining "unconfigured" case to represent).
- [x] 3.10 GREEN `builder/page.tsx` — added a `getWorkshopConfig()` read (server component), passed to `CatalogBuilderForm` as a new `workshopConfig` prop.
- [x] 3.11 GREEN `CatalogBuilderForm.tsx` — DEVIATION from the literal snippet: `logoUrl` is `workshopConfig?.logoR2Key ? "/api/workshop-config/logo" : null` (not the URL unconditionally) — the literal task snippet would render a broken `<img>` when no logo is set; gating on `logoR2Key` preserves the pre-WU3 "no `<img>` at all when unset" behavior. `templateId` resolves through `getTemplate(templateConfig?.selectedTemplateId).id` to satisfy `CatalogTemplateBranding.templateId: string` (design D2's literal type is non-nullable; the task snippet's raw `templateConfig?.selectedTemplateId` would not type-check).
- [x] 3.12 Removed the dead branding inputs (`logoUrl`/`primary`/`secondary`/`font`/`coverText`) and the inline preview `CardContent` (its backing state no longer exists — the live full-catalog preview already lives in `CatalogBuilderForm`) from `TemplateConfigForm.tsx`; shrunk `TemplateConfigInput`/`validateTemplateConfigInput` in `service.ts` to `{defaultImageHandling, selectedTemplateId}`. Translated the surviving strings: `Save`→`Guardar`, `Saving…`→`Guardando…`, `Saved. New catalogs will use this template.`→`Guardado. Los nuevos catálogos usarán esta plantilla.`, `Image handling`→`Manejo de imágenes` (+ its two option labels).
- [x] 3.13 Generated migration `0009_template_config_branding_split.sql` via `drizzle-kit generate` (matches the design's literal `DROP COLUMN` list exactly); `schema.ts` updated to match. Applied to the real dev Postgres and confirmed recorded in `drizzle.__drizzle_migrations` (not the wrong `public.__drizzle_migrations` table a past session used by mistake).
- [x] 3.14 Drain the pg-boss `pdf-generate` queue before deploying — **recorded and carried, NOT executed against production.** Dev side verified: `pgboss.job` holds zero rows in `created`/`retry`/`active` (only one completed `inventory-sync`, a different queue), so nothing was drained because nothing was queued. The production drain cannot happen during development and is not satisfied by this checkbox: it is a hard pre-deploy step, spelled out at the top of PR #36 and repeated for the `price`→`prices` payload change in PR #37. A job enqueued before the deploy and picked up by the new worker fails inside a decoupled process with nobody to report to.
- [x] 3.15 Live smoke (required): ran a throwaway `tsx` script against the real dev Postgres + real R2 bucket + real Playwright Chromium — confirmed `resolveBranding()`'s data-URI bytes are byte-for-byte identical to what `GET /api/workshop-config/logo` streams (stronger than a pixel diff: identical bytes decode to identical pixels by construction, and both paths share the one `getObject()` call with no re-encoding), confirmed the body font resolves to the registry's `"Arial, sans-serif"` not the `sans-serif` fallback, and rendered one real PDF (`page.pdf()`) showing the actual Dforce Car Audio logo, red/black template colors, and the real `workshop_config.coverText`. Script and PDF deleted after the run, not part of the PR.

**Budget stop (see apply-progress.md for the full breakdown):** real changed lines (insertions+deletions, excluding the auto-generated `meta/0009_snapshot.json`) came to 797 — well past the 500-line ledger cap and the ~450-line stop-and-report checkpoint. All 15 code/test tasks above are done and verified (`npm test` 737/737, `npx tsc --noEmit` clean, `npm run lint` 0 errors, live smoke passed), but per the explicit instruction not to self-grant a size exception, task 5.2's GGA review and PR-opening were NOT run — stopped here to report the overrun rather than push through.

## Phase 4 — WU4: Three-Tier Pricing

Files: `src/shared/template/CatalogTemplate.tsx`, `src/shared/template/AdaptiveCards.tsx`(+new test), `src/modules/catalog-builder/{CatalogBuilderForm.tsx,price-lists.ts}`(+test), `src/app/api/catalog-builder/generate/route.ts`(+test), `src/modules/pdf-generation/render.test.ts`, `src/e2e/full-flow.e2e.test.ts`.

- [x] 4.1 RED `price-lists.test.ts` — `resolveAllPrices(priceLists)` returns `{venta, taller, socio}`, each wrapping the existing `resolvePrice` (`<= 0 → null` preserved per tier).
- [x] 4.2 GREEN `price-lists.ts` — add `resolveAllPrices`.
- [x] 4.3 GREEN `CatalogTemplate.tsx` — `ProductPrintRef.price?: number | null` → `prices?: ProductPrices | null` (`ProductPrices = {venta, taller, socio}`, all `number | null`). DEVIATION: `ProductPrices` is defined and exported from `CatalogTemplate.tsx` (design D4's own code block), and `price-lists.ts`/`AdaptiveCards.tsx` import the type from there rather than redeclaring it — one canonical shape, no drift risk.
- [x] 4.4 RED `AdaptiveCards.test.tsx` (new file, closes the money-rendering test gap) — all three tiers present render bold; one tier `null` → `—`; all `null` → three `—`; a hostile `0`/`0.00` tier → `—`, never `$0.00`; both card variants (fullbleed/polaroid) render identically.
- [x] 4.5 GREEN `AdaptiveCards.tsx` — replace `ProductPrice` with one shared `ProductPrices` component; three labelled rows (`Venta`/`Taller`/`Socio` as a local constant, not imported from `catalog-builder`); em-dash rule `value == null || value <= 0 → "—"`.
- [x] 4.6 RED `render.test.ts` — rewrite the "product prices" `describe` block (currently line 128) for the `prices` shape: all-present, one-missing, all-missing, zero-tier fixtures.
- [x] 4.7 GREEN — confirmed `render.ts`/`chunkProducts` needed no change (pure pass-through); fixtures updated only, all 20 tests pass unmodified.
- [x] 4.8 RED `generate/route.test.ts` — per-tier `isPrintProduct` trust-boundary cases: non-object `prices`, array `prices`, `NaN`/`Infinity` in any tier, one tier of wrong type — each rejected individually (design D4; this is the one security-relevant boundary per the threat matrix).
- [x] 4.9 GREEN `generate/route.ts` — `isPrintProduct` validates `prices.venta`/`taller`/`socio` individually per design's `isTier` guard (extracted as `isValidPrices`).
- [x] 4.10 Rewrote the scalar-`price` shape assertions in `generate/route.test.ts` (the `VALID` fixture and the old "rejects a price sent as a string"/"non-finite price" tests, superseded by 4.8's per-tier describe block).
- [x] 4.11 RED `CatalogBuilderForm.test.tsx` (new file — none existed) — no "Lista de precios" control renders; `reviewedProducts` carries `prices: resolveAllPrices(priceLists)` (verified end-to-end via the real POST body, including a hostile `0.00` socio tier resolving to `null`).
- [x] 4.12 GREEN `CatalogBuilderForm.tsx` — removed `priceList` state + the "Lista de precios" `Select` card; `reviewedProducts` maps `prices: resolveAllPrices(priceLists)` instead of `price: resolvePrice(...)`.
- [x] 4.13 Updated `src/e2e/full-flow.e2e.test.ts` fixtures to three-tier data, including a real `0.00` tier. DEVIATION (necessary, not scope creep): the existing fixture used a flat `{id, name, category_l1, ...}` shape that predates `a828759` ("fix: correct inventory-sync mapper to match real Interfuerza 5-key wrapper contract") — `parseProduct` has required the full `{Producto, InStock, PriceLists, Images, Matrix}` wrapper since that commit, so the fixture would have thrown `"Interfuerza product is missing a usable Producto.id"` on the very first live run, regardless of any WU4 change. Fixed to the real wrapper shape as a precondition for running the REQUIRED 4.14 live smoke at all.
- [x] 4.14 Live smoke (required): ran `full-flow.e2e.test.ts` (5/5 passing) against a disposable Postgres + real Chromium — see apply-progress.md for the two pre-existing, unrelated fixture/policy fixes this required and the real SQL round-trip result.
- [x] 4.15 Live smoke: rendered one real 10-product PDF via `renderPdfBuffer` and visually inspected it — confirmed New Risk #4: the taller three-row cards pushed a `productsPerPage: 10` section across 2 physical PDF pages instead of 1 (clean row break, no card cut in half). See apply-progress.md.
- [x] 4.16 Ran `GGA_PROVIDER=claude gga run --pr-mode --diff-only` before opening this PR — 3 rounds, every WU4-authored finding fixed; two findings (pre-existing `portada.png`, pre-existing `CatalogTemplate.tsx`/`render.ts` null-branding inconsistency) repeatedly flagged against files this WU never touched — verified via `git show origin/feature/catalog-templates-and-workshop-info:<file>` and left alone per the known `--pr-mode` base-branch defect. See apply-progress.md.

## Phase 5 — WU5: Workshop Contact Block + Cover Image

Added after `sdd-verify` failed the change: the spec's ADDED requirement "Workshop Contact Block on
Cover" (`specs/catalog-generation/spec.md`) was never implemented, and no task had ever been
assigned it — the gap originated in `design.md`'s Data Flow, now corrected by D6. WU1 built the
storage and the admin form; nothing renders it. This unit closes that, and folds in the cover image
(`coverImageR2Key`) because both live on the same surface and share WU3's R2 → data URI path.

Files: `src/shared/db/schema.ts`, `src/shared/db/migrations/0010_*.sql`(+`meta/`),
`src/modules/workshop-config/{service.ts,WorkshopConfigForm.tsx}`(+tests),
`src/app/api/workshop-config/cover-image/route.ts`(new, +test),
`src/shared/template/CatalogTemplate.tsx`(+test), `src/modules/pdf-generation/{enqueue,worker}.ts`(+tests),
`src/app/api/catalog-builder/generate/route.ts`(+test), `src/modules/catalog-builder/CatalogBuilderForm.tsx`,
`src/app/(app)/builder/page.tsx`.

- [x] 6.1 Add `coverImageR2Key`/`coverImageContentType` (nullable text) to `workshopConfig` in `schema.ts`; generate migration `0010_*` (additive only, no drops).
- [x] 6.2 RED `workshop-config/service.test.ts` — the two new fields follow the same `"field" in parsed` partial-touch discipline as every other column; omitting them leaves stored values untouched.
- [x] 6.3 GREEN `workshop-config/service.ts` — extend `WorkshopConfigInput` and both upsert builders.
- [x] 6.4 RED `cover-image/route.test.ts` (new) — upload is admin-gated (`requireSession` + `can`), rejects a non-image content type, and does NOT clobber `name` or any other field (the exact bug WU1's apply-progress records fixing on the logo route).
- [x] 6.5 GREEN `api/workshop-config/cover-image/route.ts` — mirror `logo/route.ts` exactly; do not invent a second upload idiom.
- [x] 6.6 RED/GREEN `WorkshopConfigForm.test.tsx` — cover-image upload field renders and submits alongside the logo field. DEVIATION: `LogoUploadField.tsx` was parametrized (`label`/`endpoint`/`helpText` props, defaults unchanged) and reused for the cover image instead of a second near-duplicate component — same upload/preview/delete logic either way, one file to maintain.
- [x] 6.7 GREEN `design.md` D6 types — added `WorkshopContact` in `CatalogTemplate.tsx`; extended `CatalogTemplateBranding` with `coverImageUrl`/`contact`, `PdfBranding` with `coverImageR2Key`/`coverImageContentType`/`contact`. DEVIATION: both new fields are optional (`?:`), not the design's literal required shape — every pre-WU5 branding/PdfBranding object literal in the existing test suites keeps compiling unchanged; the real call sites (route.ts, worker.ts, CatalogBuilderForm.tsx) always populate them. Also added `coverImageUrl` to `CatalogTemplateBranding`, which D6's own code block omitted — the renderer cannot show the cover photo without it (same http-path/data-URI split `logoUrl` already uses).
- [x] 6.8 RED extended `render.test.ts` (not a new `CatalogTemplate.test.tsx`, same precedent as WU3's task 3.1) — every set field renders; an unset field is omitted entirely; `socialHandles` iterates entries generically; a null `contact` renders no page at all; the cover photo renders when set and is absent (no `<img>`) when not.
- [x] 6.9 GREEN `CatalogTemplate.tsx` — cover translated from `Portada_DForce_v1.html` (hero image w/ multiply blend, black wedge via `clip-path`, red diagonal accent, logo placard, brand name, claim); contact page translated from `Template_Catalogo.op` page "3 · Contacto y redes" (icon-circle rows, social-handle pills), placed LAST per that file's own page order (`0 Portada, 1 Índice, 2 Productos, 3 Contacto`) — confirmed by reading the `.op` file's page names, not assumed. BUG FOUND AND FIXED during live smoke: the cover container's background was black, but `mix-blend-mode: multiply` against black is always black — the uploaded photo was invisible. Fixed by using white background only when a cover photo is set (black/red fallback unchanged when it is not) — see live-smoke section in apply-progress.md.
- [x] 6.10 RED `worker.test.ts` — `resolveBranding()` resolves the cover image through the same server-side `getObject` path as the logo; a null `coverImageR2Key` yields `coverImageUrl: null` without throwing; also covers `contact` passthrough (both set and null).
- [x] 6.11 GREEN `worker.ts` — extended `resolveBranding()` via a small shared `resolveImageDataUri()` helper (used for both logo and cover image, avoiding duplicated R2-to-data-URI logic); `contact` passes through verbatim.
- [x] 6.12 RED `generate/route.test.ts` — `PdfBranding` assembly carries `contact` and both cover-image fields from `getWorkshopConfig()`.
- [x] 6.13 GREEN `generate/route.ts`, `CatalogBuilderForm.tsx` — assemble and pass the new branding fields; the live preview shows the same contact block as the PDF (Risk-5). `builder/page.tsx` needed no change — it already reads and forwards the full `WorkshopConfig` row. DEVIATION: added `src/modules/workshop-config/contact.ts` (`buildWorkshopContact`), a small pure function (no `@/shared/db` import, safe for the "use client" `CatalogBuilderForm.tsx`) shared by both the server route and the client preview, so the `WorkshopConfig` row → `WorkshopContact` mapping cannot drift between the two Risk-5 call sites.
- [x] 6.14 Live smoke (required): ran a throwaway `*.e2e.test.ts` (via `vitest.e2e.config.ts`, real dev Postgres already migrated through `0010`, real R2 bucket, real Playwright Chromium — deleted after the run, not part of the PR) covering both required states. State 1 (every field + 2 social handles + a real cover image) initially showed the cover-photo bug above; after the fix, re-ran and visually confirmed the cover (hero photo, wedge, accent, logo, brand, claim, title) and contact page (all 6 rows + 2 social pills) both match the approved mockups. State 2 (half the fields unset, cover image removed) confirmed WHATSAPP/DIRECCIÓN/SITIO WEB/social section all cleanly omitted (no empty labels) and the cover degraded to the plain red/black block, no broken `<img>`. See apply-progress.md for the rendered pages.
- [ ] 6.15 Before opening this PR: run `GGA_PROVIDER=claude gga run --pr-mode --diff-only`. **NOT RUN** — real changed lines came to 954 (920 insertions + 34 deletions, excluding the auto-generated `meta/0010_snapshot.json`), well past the 700-line ledger cap. Per the explicit instruction not to self-grant a size exception (same discipline as WU3's stop at 797/500), work stopped here to report the overrun rather than push through GGA/PR. All 13 code/test tasks above are done and verified (`npm test` 789/789, `npx tsc --noEmit` clean, `npm run lint` 0 errors, both required live-smoke states passed).

## Cross-cutting

- [x] 5.1 Record R8.1-superseded status: confirmed. `specs/template-config/spec.md` carries R8.1 under `## MODIFIED Requirements` and a `## REMOVED Requirements` block that names both retired requirements with a Reason and a Migration note each ("Per-Generation Font and Color Selection", "Template-Owned Logo URL and Cover Text"). The three change-folder delta specs are the artifacts `sdd-verify` checks. `openspec/specs/` does not exist yet and must not be written here — an earlier attempt to consolidate it during WU1 was reverted in `41d94fb` for asserting full-state facts that were still WU2–WU4 work. Folding the deltas into a consolidated tree is the archive step's job, now that all four units are merged and those facts are finally true.
- [x] 5.2 Before opening each of WU1-WU3's PRs: run `GGA_PROVIDER=claude gga run --pr-mode --diff-only` (WU4 covered by 4.16). DONE for WU1, WU2 and WU3. The apply agent stopped at the 500-line cap before reaching this step on WU3; the orchestrator ran it after the owner accepted the size exception — two rounds, six findings, all verified against the code and fixed in `3a1416d` and `af5e8e8` (see PR #36).
