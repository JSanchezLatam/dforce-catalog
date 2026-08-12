# Exploration: catalog-templates-and-workshop-info

Phase: `sdd-explore` · Store: hybrid (Engram `sdd/catalog-templates-and-workshop-info/explore` + this file)

The owner's five decisions are settled. This phase explored HOW, not WHETHER. Every
claim below was re-verified against the code by the orchestrator before the phase was
accepted.

## Current state

**`workshop_config`** (`src/shared/db/schema.ts:52`) is a singleton row —
`id, name, logoR2Key, logoContentType, updatedAt`. `workshop-config/service.ts` uses a
partial-field-touch upsert (`"logoR2Key" in parsed` guards) that the new contact fields
should reuse rather than reinvent. The logo is served through an **authenticated** route
(`api/workshop-config/logo/route.ts` — `requireSession` + `can`), not a plain URL.

**`template_config`** (`schema.ts:133`) is a second singleton —
`logoUrl, primaryColors (jsonb), font, coverText, defaultImageHandling` — fully
admin-editable. **12** real consumers (a grep for the type returns 14; two are
doc-comment substring matches in `customers/validation.ts` and `CustomerForm.tsx`).

**`CatalogTemplate`** is the ONE shared renderer for both the live preview and the PDF
(documented Risk-5 — never fork it). `CatalogTemplateBranding = {logoUrl, primaryColors,
font, coverText}` reaches it from `templateConfig` at two call sites:
`CatalogBuilderForm.tsx` (preview) and `generate/route.ts` (enqueue payload).

**Pricing.** `catalog-builder/queries.ts` ALREADY extracts all three ERP tiers in one SQL
pass, and `resolvePrice` ALREADY treats `0.00` as absent. The reversal is therefore
smaller than it looks: the collapse to a single tier happens only in
`CatalogBuilderForm.tsx` (`reviewedProducts` destructures `priceLists` off) and in
`generate/route.ts`'s `isPrintProduct`. The em-dash requirement is a renderer change
alone.

## Blast radius

| Area | Files |
|---|---|
| Schema + migration | `shared/db/schema.ts` (new `workshop_config` columns; `template_config` shrinks toward a selected-template id), `migrations/0008_*` |
| Workshop info | `modules/workshop-config/{service.ts,WorkshopConfigForm.tsx}`, `api/workshop-config/route.ts` + tests |
| Template gallery | `modules/template-config/*`, `app/(app)/template-config/*`, `api/template-config/route.ts` — retired or narrowed to a picker |
| Renderer | `shared/template/{CatalogTemplate.tsx,AdaptiveCards.tsx}` — branding splits into template-fixed vs workshop-owned; `ProductPrintRef.price` becomes a three-tier object |
| Builder | `modules/catalog-builder/{CatalogBuilderForm.tsx,price-lists.ts,selection.ts}` |
| Generate API | `api/catalog-builder/generate/route.ts` + `route.test.ts` (~10 tests assert the old scalar shape) |
| PDF | `modules/pdf-generation/{render.ts,render.test.ts,worker.ts,enqueue.ts}` — `render.test.ts`'s "product prices" block (from line 128) asserts the decision being reversed |
| E2E | `src/e2e/full-flow.e2e.test.ts` — the only real coverage of the hand-built price SQL |

`AdaptiveCards.tsx` has **no test file** and is about to own money rendering. Under
Strict TDD that gap must close in the same work unit.

## Approaches

**Template storage — code registry + one persisted `selectedTemplateId`, not a
`templates` table.** A registry matches "fixed per template" literally, needs no
template-engine build-out, and mirrors this repo's existing small-fixed-vocabulary
pattern (`PRICE_LISTS` as a code constant). The cost is that adding a template needs a
deploy. A DB table for template CONTENT is unrequested scope for one official template,
and the mockup has to be hand-translated to code either way.

**Workshop contact info — 6 nullable columns + one `socialHandles` JSONB.** Flat columns
for the known, validatable fields (phone, whatsapp, email, address, website, hours);
JSONB only for the genuinely open-ended platform set. One giant JSONB loses per-field
validation; a column per platform is unbounded.

## Recommended chain (~900-1150 lines total, 400-line budget)

1. Workshop contact info — ~200-250
2. Template registry + gallery, additive — ~250-300
3. Retire per-generation branding, wire the registry into the renderer — ~200-250
4. Three-tier pricing incl. e2e rewrite — ~250-350

PR2+PR3 could merge into one ~450-550 line PR with an accepted `size:exception` if a
reviewer would rather not see an intermediate state with unwired registry code. Decide
at tasks time.

## Risks

1. **Logo-sourcing conflict (unresolved).** `templateConfig.logoUrl` is Playwright-
   fetchable; `workshopConfig.logoR2Key` sits behind an authenticated route. If the cover
   logo becomes workshop-owned, the render worker must read the R2 bytes server-side and
   inline a data URI — Playwright cannot authenticate against the HTTP route.
2. **Requisito 8.1 contradicts the decision.** `.kiro/specs/dforce-catalog/requirements.md`
   states the admin SHALL be able to configure "logo, colores primarios, tipografía y
   texto de portada". Fixing typography and colour per template supersedes that; it needs
   an explicit `MODIFIED`/`REMOVED` delta, not a silent override.
3. **`isPrintProduct` is the highest-value defect target.** It is the only guard between a
   malformed payload and a crash inside a decoupled pg-boss worker with nobody to report
   to — and it is being rewritten from one scalar to three.
4. **`coverText` ownership is unspecified.** Once font and colours are template-fixed,
   whether cover text stays workshop-editable is a product decision the owner must make.
5. The mockup (`../Insumos/Templates/Template_Catalogo.op`) lives outside the repo in a
   non-text format; it becomes the first registry entry only by manual translation.

## Next

`sdd-propose`.
