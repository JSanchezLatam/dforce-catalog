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

- [ ] 1.1 RED `selection.test.ts`: `formatCatalogTitle` trims, collapses whitespace, empty gives `Catálogo`, else `Catálogo: <text>`.
- [ ] 1.2 GREEN `selection.ts`: add `formatCatalogTitle`, `MAX_CATALOG_TITLE_LENGTH = 40`; remove `deriveCatalogTitle`.
- [ ] 1.3 RED validator: 40 passes, 41 fails with Spanish `errors.title`. GREEN: `titleInput` in `validateCatalogSelection`.
- [ ] 1.4 RED route test: 41 chars gives 400 with `errors.title`, no job enqueued; stored title is `formatCatalogTitle(body.title)`. GREEN `generate/route.ts`.
- [ ] 1.5 RED `CatalogBuilderForm` test: typing updates the confirm dialog title; `errors.title` renders. GREEN: "Título del catálogo" `Input` (`maxLength={40}`); reword comment at `:259-261`.
- [ ] 1.6 RED `file/route` test: title with `"` and `—` responds 200, header has ASCII `filename=` plus `filename*=UTF-8''`. GREEN: RFC 5987 header.
- [ ] 1.7 Mutation-verify 1.1-1.6 by name.

## WU2: Portada completa (PR 2)

- [ ] 2.1 RED: registry has 2 entries, `KNOWN_TEMPLATE_IDS` includes `full-cover`, gallery shows 2 radios (`TemplateConfigForm.test.tsx:62`). GREEN: `template-ids.ts`, `registry.ts`, stub `full-cover.tsx`.
- [ ] 2.2 RED: Clásico render has no `Saira` and no `mix-blend-mode:screen`; existing `render.test.ts` and `CatalogTemplate.test.ts` pass unedited.
- [ ] 2.3 GREEN `registry-types.ts` (`CoverProps`, `BackProps`, `Cover?`, `Back?`) and `CatalogTemplate.tsx` seams: wrap `:630-700`, add `&& !template.Back` at `:934` plus sibling block. Zero modified lines inside `:630-700` and `:935-1071`; check the diff.
- [ ] 2.4 RED `full-cover.test.tsx`: first-`": "` split (lead 54px, main 800); no `": "` is all main; `titleSize` 118/84/64 at 12/24 chars; no photo gives `#0b0b0b` and no `<img>`; no logo gives no `<img>`; no name and no `coverText` omits the divider.
- [ ] 2.5 GREEN `Cover` per `mockup/cover-and-back.html`: gradient, logo `mix-blend-mode: screen`, red rule, balance wrap, 2 lines max.
- [ ] 2.6 RED back: rows mirror the presence filter, socials, footer "Precios sujetos a cambio sin previo aviso"; no contact gives no back sheet; no photo gives no strip. GREEN `Back` (lucide icons keyed by row).
- [ ] 2.7 Vendor 6 latin Saira woff2, `OFL.txt` and `saira.css` into `src/shared/template/fonts/`.
- [ ] 2.8 RED `render.test.ts`: HTML has `data:font/woff2;base64` `@font-face` and no `url(./`. GREEN `render.ts` inlining (memoised read). Import CSS in `TemplateConfigForm.tsx`; `PREVIEW_TITLE = "Catálogo: Productos"`.
- [ ] 2.9 RED `worker` test: `document.fonts.ready` awaited before `page.pdf`. GREEN `worker.ts:274`.
- [ ] 2.10 Mutation-verify 2.1-2.9 by name.

## Verification tests cannot cover

- [ ] 3.1 Generate a real PDF against a THROWAWAY user/DB, never as a real user against production R2 (retention deletes production catalogs); both templates.
- [ ] 3.2 Open the preview and the PDF at `http://<LAN-ip>:3000`, not localhost; read the console for hydration errors.
- [ ] 3.3 Offline font check: network off, regenerate, inspect the PDF's embedded fonts for Saira.
- [ ] 3.4 Logo screen-blend check in the PDF (`printBackground: true`): logo reads solid on near-black.
- [ ] 3.5 A 40-char title stays within 2 lines inside the cover block.

## Spec archive notes

- [ ] 4.1 At archive, merge the three delta specs; the catalog-generation delta adds a requirement the main spec never had (not a rename).
- [ ] 4.2 Merge order with PRs #145 and #146 (same `deriveCatalogTitle` lines, form and spec): rebase this change after them.
