# Proposal: Catalog Cover Templates

## Intent

The workshop wants a second catalog look built around the cover photo: a full-bleed cover and a matching back (contact) page, per the owner-approved `mockup/cover-and-back.html` (+ `.png`). That file is the visual source of truth; `mockup/cover-mockup*.png` are superseded. The owner also set a rule for the catalog title: the operator types it.

Scope is deliberately minimal (owner, 2026-10-03: "solo era cambiar la portada"). "Dforce Clásico" is not edited — its JSX stays where it is.

## Scope

### In Scope
- Template "Portada completa" (`full-cover`): full-bleed cover and dark back page per the mockup, Saira Condensed + Saira on those two pages only. Interior pages, cards, colours and the body font are Clásico's.
- Two optional seams on the template contract, `Cover?` and `Back?`; a template without them renders today's markup untouched.
- Catalog title typed by the operator ("Título del catálogo", optional, max 40 characters). Heading is `Catálogo: <text>`, or `Catálogo` when empty. The stored `catalogs.title` and the PDF filename follow. Applies to both templates and replaces `deriveCatalogTitle`.
- Self-hosted Saira woff2 files (OFL), inlined into the worker's HTML because the workshop PC may be offline.
- Download filename made safe for any typed title (RFC 5987 `filename*`).

### Out of Scope
- Clásico refactor or extraction, golden snapshots.
- Gallery miniature render (follow-up; the gallery lists the second entry with the existing swatch).
- Editable base colours (future change).
- Login screen reading the uploaded photo.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `template-config`: multi-entry gallery; per-template cover and back layouts with fallbacks.
- `workshop-settings`: documents the existing cover image as workshop-owned content.
- `catalog-generation`: operator-typed catalog title.

## Approach

`CatalogTemplate` branches `template.Cover ? <Cover/> : (existing cover)` and the same for the contact sheet, without editing the existing lines. `fullCover` spreads `dforceClassic` and adds `Cover`/`Back`. A pure `formatCatalogTitle` in `selection.ts` is shared by the builder (preview, confirm dialog) and the generate route (authoritative). Fonts live next to the template as one CSS file. The app imports it, and `render.ts` inlines it as data URIs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/template/` (`CatalogTemplate.tsx`, `registry*.ts`, `template-ids.ts`) | Modified | Seams, second entry |
| `src/shared/template/templates/full-cover.tsx`, `fonts/` | New | Cover, back, fonts |
| `src/modules/pdf-generation/render.ts`, `worker.ts` | Modified | Font inlining, wait for fonts |
| `src/modules/catalog-builder/` (`selection.ts`, `CatalogBuilderForm.tsx`) | Modified | Title input and rule |
| `src/app/api/catalog-builder/generate/route.ts`, `src/app/api/catalogs/[id]/file/route.ts` | Modified | Title validation, filename |
| `src/modules/template-config/TemplateConfigForm.tsx` | Modified | Font CSS import, preview title |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `mix-blend-mode: screen` or web fonts misrender in the Chromium PDF | Med | Verify a real PDF, not the page |
| Conflicts with open PRs #145 (`deriveCatalogTitle`) and #146 (`CatalogBuilderForm.tsx`, catalog-generation spec) | High | Land after them, or rebase; this change supersedes #145's title wording |
| Placeholder photo (736x981) prints soft | High | Owner supplies the original; layout tolerates low resolution |
| Diff above the 400-line budget | Med | Forecast in tasks; fonts and licence are vendored, not authored |

## Rollback Plan

Remove the `full-cover` registry entry; orphaned selections fall back to the default (R8.4). The title input is a single revert of its commit; titles already stored stay as typed.

## Dependencies

- Owner-approved `mockup/cover-and-back.html` (approved 2026-10-03).
- Order relative to PRs #145 and #146.

## Success Criteria

- [ ] Clásico's cover and contact JSX lines are unchanged in the diff, and its existing tests pass unedited.
- [ ] "Portada completa" matches the mockup in the preview and in the printed PDF (logo reads solid).
- [ ] Typed title prints as `Catálogo: <text>`; empty prints `Catálogo`; 41 characters are refused on both client and server.
- [ ] A PDF generated offline uses Saira.
