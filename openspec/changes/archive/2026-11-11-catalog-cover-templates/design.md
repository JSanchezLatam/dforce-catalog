# Design: Catalog Cover Templates

## Technical Approach

Visual source: `mockup/cover-and-back.html`. Add the second registry entry `fullCover = { ...dforceClassic, id: "full-cover", name: "Portada completa", Cover, Back }`. It keeps Clásico's `font` (Arial), colours and `Card` (`dforce-classic.tsx:29-40`), so interior pages do not change. Saira is set inline inside `Cover`/`Back` only. `CatalogTemplate` branches on the optional seams and leaves every existing Clásico line byte-identical.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Clásico seam | extract `ClassicCover` / wrap in place | Extraction moves ~70 lines (`CatalogTemplate.tsx:630-700`) and needs a golden. No formatter runs in this repo (`package.json:9` is eslint only; no prettier config), so wrapping needs no re-indent | Insert `{template.Cover ? (<Sheet cover><template.Cover …/></Sheet>) : (` before `:630` and `)}` after `:700`. For the back sheet, add `&& !template.Back` to `:934` and a sibling block |
| Who owns `<Sheet>` | template / `CatalogTemplate` | `Sheet` is private (`:406`); `data-sheet` is the selector tests use (`render.test.ts:814`) | `CatalogTemplate`. Seams return content only |
| Back-page data | import `CONTACT_ROWS` / pass rows | importing a runtime value from `CatalogTemplate.tsx` turns the type-only cycle in `registry-types.ts:6-17` into a runtime one | `CatalogTemplate` passes `rows = CONTACT_ROWS.filter(…)` (`:84-91`) and socials. The `hasContactContent` guard (`:132`, `:934`) gates both templates |
| Icons | inline SVG paths / `lucide-react` | already a dependency (`package.json:27`); plain SVG, so it works in `renderToStaticMarkup` | lucide, `stroke` = red, keyed by row key |
| Title rule | client only / route also | the client is untrusted (`generate/route.ts:26-28`) | Pure `formatCatalogTitle` + `MAX_CATALOG_TITLE_LENGTH = 40` replace `deriveCatalogTitle` (`selection.ts:138-141`); `validateCatalogSelection` (`:196`) gains `titleInput`; the route stores `formatCatalogTitle(body.title)` (`:164`) |
| Cover split | new payload field / split the title | the payload already carries one `title` | `Cover` splits on the first `": "`: lead `Catálogo:` (light, 54px) plus main (800). No `": "` → all of it is main |
| Long titles | ellipsis / step down | 40 characters at 118px is about 4 lines over 688px (the mockup's `REPUESTOS` is ~54px per glyph) | main ≤12 chars → 118px, ≤24 → 84px, else 64px; `text-wrap: balance`, `overflow-wrap: anywhere`; ≤2 lines |
| Fonts | Google CDN / `next/font` / vendored | the workshop PC may be offline; `next/font/google` (`layout.tsx:3`) needs network at build time | Vendored latin woff2 (6 files) + `OFL.txt` in `src/shared/template/fonts/`, one `saira.css` |
| Inlining | manifest in TS / read the CSS | one source of truth | `render.ts` reads `saira.css` once (memoised; `process.cwd()`), replaces each `url("./x.woff2")` with a base64 `data:` URI and adds it to the `<style>` (`render.ts:105-121`). The preview imports the same CSS in `TemplateConfigForm.tsx`, served from `_next/static`, which `proxy.ts:16` leaves public |
| Font timing | trust `load` / wait | `setContent(… "load")` (`worker.ts:270`) does not wait for font faces | `await page.evaluate(() => document.fonts.ready)` before `page.pdf` (`:274`). The measuring pass is unaffected, because cards stay Arial |
| Filename | keep / RFC 5987 | `filename="${catalog.title}.pdf"` (`file/route.ts:55`): a typed `"` breaks the header, and a character above U+00FF throws in `Headers` | ASCII fallback `filename=` plus `filename*=UTF-8''${encodeURIComponent}` |

### Print notes

- `mix-blend-mode: screen` on the logo makes the black of the logo JPEG disappear. The top of the cover overlay is near-black (`rgba(0,0,0,.92)` to `#000`), so the logo reads solid. Skia PDF supports the blend mode natively, but it has never been rendered here, so verify it in a real PDF with `printBackground: true` (`worker.ts:274`).
- Archive gap #4 (`render.test.ts:819-833`) was multiply against black. Screen against black is the intended identity, and that test only covers Clásico.

### Fallbacks

- No photo: `#0b0b0b` sheet with no `<img>`, and no strip on the back page.
- No logo: no `<img>` and no plate.
- No name and no `coverText`: the divider row is omitted.

## Data Flow

    builder input ──► formatCatalogTitle ──► preview / ConfirmGenerateDialog
          └── POST title (raw) ──► route: validate ≤40, formatCatalogTitle ──► payload.title ──► catalogs.title / filename
    worker: renderCatalogHtml ── <style> + saira @font-face (data URIs)
             └─ CatalogTemplate ── template.Cover ? Cover(split title) : Clásico JSX
                                └─ template.Back  ? Back(rows, socials) : Clásico contact JSX

## File Changes

| File | Action | Description |
|---|---|---|
| `src/shared/template/template-ids.ts` | Modify | add `"full-cover"` (`:12`) |
| `src/shared/template/registry-types.ts` | Modify | `CoverProps`, `BackProps`, `Cover?`, `Back?` |
| `src/shared/template/registry.ts` | Modify | `[dforceClassic, fullCover]` (`:15`) |
| `src/shared/template/CatalogTemplate.tsx` | Modify | two seams, existing lines untouched |
| `src/shared/template/templates/full-cover.tsx` | Create | entry, `Cover`, `Back`, `titleSize` |
| `src/shared/template/fonts/{saira.css,*.woff2,OFL.txt}` | Create | vendored fonts |
| `src/modules/pdf-generation/render.ts`, `worker.ts` | Modify | inline fonts; `fonts.ready` |
| `src/modules/catalog-builder/selection.ts`, `CatalogBuilderForm.tsx` | Modify | title rule; "Título del catálogo" `Input` (`maxLength={40}`) in the review card (`:802`), inline `errors.title` |
| `src/app/api/catalog-builder/generate/route.ts` | Modify | validate and format the title |
| `src/app/api/catalogs/[id]/file/route.ts` | Modify | safe filename |
| `src/modules/template-config/TemplateConfigForm.tsx` | Modify | CSS import; `PREVIEW_TITLE = "Catálogo: Productos"` (`:33`) |

## Interfaces / Contracts

```ts
type CoverProps = { title: string; logoUrl: string | null; coverImageUrl: string | null;
  workshopName: string | null; coverText: string | null; red: string };
type BackProps = { rows: { key: ContactRowKey; label: string; value: string }[];
  socials: [string, string][]; logoUrl: string | null; coverImageUrl: string | null; red: string };
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Clásico identity | unchanged output | Existing `render.test.ts` and `CatalogTemplate.test.ts` pass unedited. One new assertion: a Clásico render contains no `Saira` and no `mix-blend-mode:screen`. Reviewing the diff confirms zero modified lines inside `:630-700` and `:935-1071` |
| Unit | full cover | split and fallbacks; `titleSize` steps; back rows mirror the presence filter; no contact → no back sheet; no photo → no `<img alt="">` |
| Unit | title | `formatCatalogTitle` (trim, collapse whitespace, empty); 40 passes and 41 fails in the validator; route 400 with `errors.title`; filename header with `"` and `—` |
| Component | builder | typing updates the confirm dialog's title; `errors.title` renders; gallery has 2 radios (`TemplateConfigForm.test.tsx:62`) |
| Browser/PDF | blend, fonts | PDF of both templates at the LAN IP, network off; inspect the PDF, not the page |

Mutation-verify each new test.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration. A browser tab opened before the deploy still sends the old derived title (`Catalog: A, B`). It either gets prefixed or fails the length check. Reload fixes it.

## WU3: Per-Template Cover Image

Owner decision, 2026-10-03: one shared photo always ruins one cover. Visual source: `mockup/template-config-images.html`. The worker needs no change. `PdfBranding` already carries an R2 key per job (`generate/route.ts:179-180`), and `resolveBranding` already inlines it (`worker.ts:102-105`). Only the place that chooses the key changes.

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Storage | jsonb map on `template_config` / table | a map makes upload/delete a read-modify-write on the singleton row | `template_cover_image(template_id text PK, r2_key text NOT NULL, content_type text, updated_at)`, with no FK, because ids live in code (`template-ids.ts:12`) |
| Legacy image | runtime fallback to `workshop_config` for every template / for Clásico only / copy it once | A fallback for every template shows the white car on "Portada completa", the exact defect the owner rejected. Any runtime fallback adds a branch to three readers, and "Eliminar" on Clásico would bring the old image back | The `0020` migration (`drizzle-kit generate`, schema changed) ends with `INSERT … SELECT 'dforce-classic', cover_image_r2_key, cover_image_content_type, now() FROM workshop_config WHERE cover_image_r2_key IS NOT NULL`, the same backfill pattern as `0013`. There is no runtime fallback. "Portada completa" starts with no image and uses the dark fallback that is already specified |
| Who picks the key | worker / generate route | the route already reads both configs (`route.ts:164`) | route: add `listTemplateCoverImages()` to that `Promise.all`, then `find(templateId)` |
| Routes | one route per template / `[templateId]` | — | `src/app/api/template-config/cover-image/[templateId]/route.ts`, a line-for-line copy of `workshop-config/cover-image/route.ts`. Unknown id → 404. Key `covers/<id>/<ts>.<ext>`. DELETE also deletes the object (with `.catch`). The GET headers are copied verbatim, including the CSP sandbox, because `validateLogo` accepts SVG |
| Permission | `workshop.*` / `template.edit` | the image is now template config, and only that admin page reads it | `template.edit` for GET/POST/DELETE (`page.tsx:25`, `template-config/route.ts:16`). One `ROUTE_GUARDS` row (`route-guards.test.ts:47`) |
| Upload UI | new Subir/Cambiar/Quitar component / existing `LogoUploadField` | it is already parametrised by `label`/`endpoint`/`helpText` (`LogoUploadField.tsx:14-20`) | Reuse it unchanged except `min-h-11` on its file `Input` and "Eliminar" (`:86-99`; both are 32px or less today), which also fixes the logo field |
| Slot placement | inside the tile's `<label>` / beside it | a file input inside the radio's `<label>` (`TemplateConfigForm.tsx:132`) toggles the radio and nests interactive content | each entry becomes a column: the tile `<label>`, then the slot. Label `Imagen de portada de ${name}` (two slots need unique accessible names). Per-template hint as `helpText`, from a `Record<TemplateId, string>` so a third template fails `tsc` until it has one |
| Toast | — | `LogoUploadField` calls `onUpdate` only after `res.ok` (`:57-58`, `:70`) | in `onUpdate`, `addToast("success", key ? "Imagen de portada guardada" : "Imagen de portada quitada")`. No `router.refresh`: the preview reads local state |
| Preview | — | the builder has no preview since F1 (`TemplateConfigForm.tsx:61-67`) | `coverImageUrl = keys[selectedId] ? \`/api/template-config/cover-image/${id}?v=${key}\` : null` replaces `:227`. `?v=` defeats the 60 s cache |
| Workshop field | redirect / remove | — | remove `WorkshopConfigForm.tsx:146-153` and its two tests (`WorkshopConfigForm.test.tsx:254-273`). Delete the workshop route plus its test and guard row. Keep the columns: dropping them blocks rollback (follow-up) |

Data flow: upload → route → R2 put, upsert row, delete the old object. Generate: `selectedTemplateId` → row → `PdfBranding.coverImageR2Key` → worker (unchanged). Page → `listTemplateCoverImages()` → form `coverImageKeys`.

**Size and split**, authored lines (snapshot and journal excluded):

| PR | Scope | ~Lines |
|---|---|---|
| WU3a | schema, `0020`, three service functions (`list`, upsert, delete) + tests, `[templateId]` route + test, guard row, generate route + test | 340 |
| WU3b | page, form slots, toast and preview + tests, `LogoUploadField` targets, the workshop field removed | 190 |
| WU3c | delete the workshop cover-image route, its test and its guard row (deletion only) | 280 |

**Owner approval (2026-10-03):** `mockup/template-config-images.png` approved, including "Portada completa" starting on the dark no-photo cover until it gets its own image. Delivery: two PRs — WU3a, then WU3b and WU3c together (WU3c is deletion only). Help text must not mention SVG: covers accept PNG, JPEG or WebP.

Testing: route tests copy `cover-image/route.test.ts` and add an unknown-id 404 and a cross-template isolation case. The generate route picks the selected template's row, and passes null when the row is absent even if the workshop key is set. Form: two slots, unique labels, toast text, and the preview `src` follows the radio. Real SQL: an e2e upsert/list/delete row, and the backfill proven inside `BEGIN … ROLLBACK` (memory: migrations recipe). Browser: at the LAN IP, upload to both slots and switch the radio, then check the PDF for both templates.

Threat matrix: N/A (an upload route that mirrors an existing one; no shell, subprocess or VCS boundary).

## Open Questions

- [ ] Merge order with PRs #145 and #146. This change rewrites the same `deriveCatalogTitle` lines and the same form and spec.
- [ ] The comment at `CatalogBuilderForm.tsx:259-261` mentions the derived "Catalog" title. Reword it in the same commit.
