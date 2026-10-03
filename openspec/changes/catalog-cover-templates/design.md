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

## Open Questions

- [ ] Merge order with PRs #145 and #146. This change rewrites the same `deriveCatalogTitle` lines and the same form and spec.
- [ ] The comment at `CatalogBuilderForm.tsx:259-261` mentions the derived "Catalog" title. Reword it in the same commit.
