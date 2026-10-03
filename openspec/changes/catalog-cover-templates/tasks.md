# Tasks: Catalog Cover Templates

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~750 (WU1 ~250, WU2 ~500); woff2 binaries and `OFL.txt` excluded |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (title rule + filename) then PR 2 (template, fonts); the title rule is the split-off PR, as design suggests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Operator-typed title, 40-char limit, safe filename | PR 1 (base: tracker/main) | `npx vitest run src/modules/catalog-builder src/app/api` | Throwaway DB: generate with `"` and `—` titles, download | Revert title commit; stored titles stay |
| 2 | Portada completa: seams, cover/back, fonts | PR 2 (base: PR 1 branch) | `npx vitest run src/shared/template src/modules/pdf-generation src/modules/template-config` | Real PDF on throwaway DB at LAN IP | Remove registry entry; selections fall back (R8.4) |

Rule for every task pair: RED test, confirm red, GREEN, then mutation-verify (revert the fix, the named test goes red).

## WU1: Title rule and filename (PR 1)

- [x] 1.1 RED `selection.test.ts`: `formatCatalogTitle` trims, collapses whitespace, empty gives `Catálogo`, else `Catálogo: <text>`.
- [x] 1.2 GREEN `selection.ts`: add `formatCatalogTitle`, `MAX_CATALOG_TITLE_LENGTH = 40`; remove `deriveCatalogTitle`.
- [x] 1.3 RED validator: 40 passes, 41 fails with Spanish `errors.title`. GREEN: `titleInput` in `validateCatalogSelection`.
- [x] 1.4 RED route test: 41 chars gives 400 with `errors.title`, no job enqueued; stored title is `formatCatalogTitle(body.title)`. GREEN `generate/route.ts`.
- [x] 1.5 RED `CatalogBuilderForm` test: typing updates the confirm dialog title; `errors.title` renders. GREEN: "Título del catálogo" `Input` (`maxLength={40}`); reword comment at `:259-261`.
- [x] 1.6 RED `file/route` test: title with `"` and `—` responds 200, header has ASCII `filename=` plus `filename*=UTF-8''`. GREEN: RFC 5987 header.
- [x] 1.7 Mutation-verify 1.1-1.6 by name.

## WU2: Portada completa (PR 2)

- [x] 2.1 RED: registry has 2 entries, `KNOWN_TEMPLATE_IDS` includes `full-cover`, gallery shows 2 radios (`TemplateConfigForm.test.tsx:62`). GREEN: `template-ids.ts`, `registry.ts`, stub `full-cover.tsx`.
- [x] 2.2 RED: Clásico render has no `Saira` and no `mix-blend-mode:screen`; existing `render.test.ts` and `CatalogTemplate.test.ts` pass unedited.
- [x] 2.3 GREEN `registry-types.ts` (`CoverProps`, `BackProps`, `Cover?`, `Back?`) and `CatalogTemplate.tsx` seams: wrap `:630-700`, add `&& !template.Back` at `:934` plus sibling block. Zero modified lines inside `:630-700` and `:935-1071`; check the diff.
- [x] 2.4 RED `full-cover.test.tsx`: first-`": "` split (lead 54px, main 800); no `": "` is all main; `titleSize` 118/84/64 at 12/24 chars; no photo gives `#0b0b0b` and no `<img>`; no logo gives no `<img>`; no name and no `coverText` omits the divider.
- [x] 2.5 GREEN `Cover` per `mockup/cover-and-back.html`: gradient, logo `mix-blend-mode: screen`, red rule, balance wrap, 2 lines max.
- [x] 2.6 RED back: rows mirror the presence filter, socials, footer "Precios sujetos a cambio sin previo aviso"; no contact gives no back sheet; no photo gives no strip. GREEN `Back` (lucide icons keyed by row).
- [x] 2.7 Vendor 6 latin Saira woff2, `OFL.txt` and `saira.css` into `src/shared/template/fonts/`.
- [x] 2.8 RED `render.test.ts`: HTML has `data:font/woff2;base64` `@font-face` and no `url(./`. GREEN `render.ts` inlining (memoised read). Import CSS in `TemplateConfigForm.tsx`; `PREVIEW_TITLE = "Catálogo: Productos"`.
- [x] 2.9 RED `worker` test: `document.fonts.ready` awaited before `page.pdf`. GREEN `worker.ts:274`.
- [x] 2.10 Mutation-verify 2.1-2.9 by name.

## Verification tests cannot cover

- [ ] 3.1 Generate a real PDF against a THROWAWAY user/DB, never as a real user against production R2 (retention deletes production catalogs); both templates.
- [ ] 3.2 Open the preview and the PDF at `http://<LAN-ip>:3000`, not localhost; read the console for hydration errors.
- [ ] 3.3 Offline font check: network off, regenerate, inspect the PDF's embedded fonts for Saira.
- [ ] 3.4 Logo screen-blend check in the PDF (`printBackground: true`): logo reads solid on near-black.
- [ ] 3.5 A 40-char title stays within 2 lines inside the cover block.

## Spec archive notes

- [ ] 4.1 At archive, merge the three delta specs; the catalog-generation delta adds a requirement the main spec never had (not a rename).
- [ ] 4.2 Merge order with PRs #145 and #146 (same `deriveCatalogTitle` lines, form and spec): rebase this change after them.

---

# WU3: Per-Template Cover Image (appended 2026-10-03)

## WU3 Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR A ~340 (WU3a); PR B ~470 (WU3b ~190 + WU3c ~280, WU3c is deletion only); migration snapshot and journal excluded |
| 400-line budget risk | PR A: Medium (tests dominate); PR B: High on paper, Low in review effort (60% deletion) |
| Chained PRs recommended | Yes |
| Suggested split | PR A = WU3a (branch `feat/template-cover-images`, based on PR #148) then PR B = WU3b + WU3c (branch based on PR A) |
| Delivery strategy | ask-on-risk (resolved) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

PR B is above 400 only because of deleted lines; the owner accepted the 2-PR delivery. If authored additions in PR B exceed ~250, split WU3c back out.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 3a | Table, `0020` backfill, service, `[templateId]` route, guard row, generate picks per-template key | PR A (base: PR #148 branch) | `npx vitest run src/modules/template-config src/app/api/template-config src/app/api/catalog-builder` | e2e row + `BEGIN…ROLLBACK` backfill smoke on throwaway DB | Revert PR A; old route and workshop columns still work |
| 3b | Slots in the form, toast, preview, 44px targets, workshop field removed | PR B (base: PR A branch) | `npx vitest run src/modules/template-config src/modules/workshop-config src/shared/ui` | LAN-IP browser check with throwaway user | Revert the form commits; routes from PR A stay |
| 3c | Delete workshop cover-image route, test, guard row | PR B (same PR, own commit) | `npx vitest run src/app/api/route-guards.test.ts` | N/A: deletion only; `npx tsc --noEmit` proves no caller | Revert the commit; columns were never dropped |

Rule for every pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red). Copy `cover-image/route.test.ts`; fixtures must match the wire.

## WU3a: Storage, routes, generate (PR A)

- [ ] 5.1 RED `route-guards.test.ts`: row for `/api/template-config/cover-image/[templateId]` GET/POST/DELETE requires `template.edit`. GREEN: add the row (`:47`) with the route in 5.7.
- [ ] 5.2 `schema.ts`: add `templateCoverImage` (`template_id text PK`, `r2_key text NOT NULL`, `content_type text`, `updated_at`), no FK. Run `drizzle-kit generate` to produce `0020`.
- [ ] 5.3 Append to `0020`: `INSERT INTO template_cover_image … SELECT 'dforce-classic', cover_image_r2_key, cover_image_content_type, now() FROM workshop_config WHERE cover_image_r2_key IS NOT NULL` (pattern of `0013`). No runtime fallback.
- [ ] 5.4 RED service tests (injected seam): `listTemplateCoverImages` returns rows; upsert replaces and returns the previous key; delete returns the removed key or null. GREEN: three functions in `src/modules/template-config/service.ts`.
- [ ] 5.5 RED e2e `src/e2e/template-cover-image.e2e.test.ts` (throwaway DB recipe, never the dev DB): real upsert, list, replace, delete, and PK uniqueness across two ids. GREEN: fix any real-SQL defect found.
- [ ] 5.6 Backfill smoke on a THROWAWAY copy (`pg_dump` to a scratch DB): inside `BEGIN … ROLLBACK`, run `0020`'s INSERT with a set key (row appears under `dforce-classic`) and with NULL (no row). Record the result in the PR body. Never run it destructively on the dev DB's real data.
- [ ] 5.7 RED route tests (copy `workshop-config/cover-image/route.test.ts`): unknown id 404 on GET/POST/DELETE; no `template.edit` 403, nothing stored; POST stores under `covers/<id>/<ts>.<ext>` and deletes the old object; DELETE removes row and object (`.catch` on R2 failure); cross-template isolation (upload for A leaves B untouched); GET keeps CSP sandbox headers. GREEN: `src/app/api/template-config/cover-image/[templateId]/route.ts`.
- [ ] 5.8 RED `generate/route.test.ts`: `selectedTemplateId` picks that template's row key; no row gives `coverImageR2Key: null` even when `workshop_config` has a key; the other template's key is never used. GREEN: add `listTemplateCoverImages()` to the `Promise.all` (`route.ts:164`) and `find(templateId)`. Worker untouched.
- [ ] 5.9 Mutation-verify 5.1-5.8 by name; `npx tsc --noEmit`, `npm test`, `npm run lint` (14 warnings), `gga run --pr-mode --diff-only`.

## WU3b: Form slots and workshop field removal (PR B)

- [ ] 6.1 RED `page` test: `page.tsx` passes `coverImageKeys` from `listTemplateCoverImages()`. GREEN `src/app/(dashboard)/.../template-config/page.tsx` (`:25` permission unchanged).
- [ ] 6.2 RED `TemplateConfigForm.test.tsx`: two slots with unique labels `Imagen de portada de Dforce Clásico` / `... de Portada completa`; the file input is NOT inside the radio's `<label>`. GREEN: each entry becomes a column (tile `<label>`, then `LogoUploadField` slot).
- [ ] 6.3 RED: per-template help text from a `Record<TemplateId, string>` (compile-time exhaustive); text in Spanish and mentions PNG, JPEG or WebP and 2MB, and does NOT contain `SVG` (assert absence by regex; the mockup's SVG wording is superseded by the owner note). GREEN.
- [ ] 6.4 RED toast: upload success calls `addToast("success", "Imagen de portada guardada")`, removal `"Imagen de portada quitada"`; no toast when the response is not ok. GREEN in `onUpdate`, with no `router.refresh` (preview reads local state). If a refresh is ever added, toast goes ABOVE it and both BELOW the `try/catch`.
- [ ] 6.5 RED preview: `coverImageUrl` is `/api/template-config/cover-image/<id>?v=<key>` for the selected radio and null when that template has no key; switching the radio changes the `src`. GREEN: replace `:227`.
- [ ] 6.6 44x44 targets: add `min-h-11` (and `min-w-11` on "Eliminar") to `LogoUploadField`'s file `Input` and "Eliminar" (`:86-99`); also fixes the logo field. A test cannot assert height, so measure in the browser in 6.12 and say so in the PR.
- [ ] 6.7 RED `WorkshopConfigForm.test.tsx`: "Imagen de portada" field is absent (replaces the two tests at `:254-273`). GREEN: remove `WorkshopConfigForm.tsx:146-153`. Keep the DB columns (follow-up).
- [ ] 6.8 Mutation-verify 6.1-6.7 by name (re-add the field, put the input inside the label, drop a toast).

## WU3c: Retire the workshop route (PR B, separate commit)

- [ ] 7.1 Confirm no callers: `rg "workshop-config/cover-image"` returns only the files to delete. Then delete `src/app/api/workshop-config/cover-image/route.ts`, its test and its `ROUTE_GUARDS` row.
- [ ] 7.2 RED/GREEN guard: `route-guards.test.ts` still passes and the new template route row remains (mutate: remove the new row, the guard test goes red).
- [ ] 7.3 `npx tsc --noEmit`, `npm test`, `npm run lint`, then `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to PR A's branch (auto-detect resolves to `main`).

## WU3 Verification tests cannot cover

- [ ] 8.1 Create a THROWAWAY user and use a QA-only key prefix; never generate catalogs as a real user against production R2 (retention deletes production catalogs).
- [ ] 8.2 At `http://<LAN-ip>:3000`, not localhost: upload in both slots, switch the radio, confirm the preview follows, read the console for hydration errors, confirm the toast shows and "Eliminar" works.
- [ ] 8.3 Measure the file input and "Eliminar" at 44x44 or more in the browser.
- [ ] 8.4 Generate a PDF per template (throwaway DB); each cover shows its own image, and "Portada completa" without one shows the dark fallback.
- [ ] 8.5 Delete the QA objects from R2 and the throwaway user afterwards; confirm Clásico still has the migrated image.
- [ ] 8.6 At archive, merge the template-config and workshop-settings deltas (the cover-image field removal is a MODIFIED scenario, not a rename).
