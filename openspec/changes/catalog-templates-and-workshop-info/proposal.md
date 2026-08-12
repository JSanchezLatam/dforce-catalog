# Proposal: Catalog Templates and Workshop Info

Phase: `sdd-propose` · Store: hybrid (Engram `sdd/catalog-templates-and-workshop-info/proposal` + this file)

## Intent

A generated catalog today carries no workshop identity beyond a logo, its branding is
re-chosen on every generation, and each product shows a single price tier. The workshop
cannot hand a customer a catalog that says who to call, and PR #27/#28 dropped two of the
three tiers the ERP already returns. This change makes branding a fixed property of a
chosen template, makes contact data a property of the workshop, and restores all three
tiers.

## Scope

### In scope

- `workshop_config` gains contact fields + `coverText`; form, service, API extended.
- A code template registry; the `Template_Catalogo.op` mockup becomes its first entry.
- A gallery picker in the builder; the chosen template id is persisted.
- Per-generation font/colour selection retired.
- Every card renders Venta / Taller / Socio, bold, em-dash when a tier is absent.
- A test file for `AdaptiveCards.tsx` (Strict TDD; it is about to own money rendering).

### Out of scope

- Admin-authored or DB-stored templates. A second template is an additive PR.
- Any change to `queries.ts`' price SQL — it already returns all three tiers.
- Forking `CatalogTemplate` (Risk-5). One renderer serves preview and PDF.
- Reworking the logo upload/serving route itself.

## Resolved conflicts

**A — Logo sourcing.** `logoUrl` stays a plain string on the branding type, and the two
call sites supply different values. The browser preview passes
`/api/workshop-config/logo`, where the session cookie already authenticates. The worker
cannot, so `renderPdfBuffer` (`pdf-generation/worker.ts`) resolves `logoR2Key` through
`getObject()` and inlines a `data:` URI before calling `renderCatalogHtml`. The enqueue
payload carries the *key*, never base64 — that module already documents why binary must
not sit in a pg-boss JSONB row. The renderer stays unforked and unaware.

**B — Requisito 8.1 is superseded.** `.kiro/specs/dforce-catalog/requirements.md:160`
requires the admin to configure "colores primarios, tipografía". Fixing those per
template contradicts it. This change **supersedes R8.1**; `sdd-spec` owes an explicit
MODIFIED delta on `template-config` — typography and colour move to the template, logo
and cover text stay workshop-owned. R8.4's persistence requirement survives, carried by
the stored template id (unknown id → fall back to the one official template).

## Approach

**Template storage — agreed with exploration: code registry + one persisted id.** Page
structure is JSX, not data; a `templates` table stores it only by building a template
engine nobody asked for. `template_config` shrinks to `selectedTemplateId` +
`defaultImageHandling`; `font`, `primaryColors`, `logoUrl`, `coverText` are dropped, with
`coverText` re-landing on `workshop_config`. Cost accepted: a new template needs a deploy.

**Workshop columns.** Six nullable text columns (`phone`, `whatsapp`, `email`, `address`,
`website`, `hours`) plus `coverText`, plus one `socialHandles` jsonb for the open-ended
platform set. Flat columns keep per-field validation; a new social platform must not need
a migration. Reuse the existing `"field" in parsed` partial-touch upsert discipline.

**Pricing.** `ProductPrintRef.price` becomes `prices: {venta, taller, socio}`. A thin
`resolveAllPrices` wraps the existing `resolvePrice`, whose `<= 0 → null` behaviour is
already exactly the em-dash rule. `isPrintProduct` must validate all three fields
individually — it is the only guard between a malformed payload and a `TypeError` in a
detached worker.

## Capabilities

There is no `openspec/specs/` tree; deltas live in the change folder.

### New capabilities

- None.

### Modified capabilities

- `template-config`: branding fixed per template, selected via gallery; supersedes R8.1.
- `workshop-settings`: contact info + cover text become workshop-owned.
- `catalog-generation`: three-tier price table; workshop contact block on the catalog.

## Affected areas

| Area | Impact | Description |
|---|---|---|
| `src/shared/db/schema.ts`, `migrations/0008_*` | Modified | Workshop columns added; template columns dropped |
| `src/modules/workshop-config/*` | Modified | Validation, upsert, form fields |
| `src/shared/template/registry.ts` | New | Template definitions + fallback lookup |
| `src/modules/template-config/*`, `app/(app)/template-config/*` | Modified/Removed | Admin branding form narrows to a picker |
| `src/shared/template/{CatalogTemplate,AdaptiveCards}.tsx` | Modified | Branding split; three-tier price table |
| `src/shared/template/AdaptiveCards.test.tsx` | New | Closes the money-rendering test gap |
| `src/modules/catalog-builder/{CatalogBuilderForm,price-lists}.ts(x)` | Modified | Tier dropdown removed; ships all three |
| `src/modules/pdf-generation/{worker,render}.ts` + tests | Modified | Data-URI logo; single-tier test block rewritten |
| `src/app/api/catalog-builder/generate/route.ts` + test | Modified | `isPrintProduct` rewrite; ~10 tests rewritten |
| `src/e2e/full-flow.e2e.test.ts` | Modified | Three-tier fixtures; the only real SQL coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `isPrintProduct` rewrite weakens the worker trust boundary | Med | Validate each of three fields individually; test each |
| Green unit suite proves nothing about the price SQL | High | Run the live e2e before merging the pricing unit |
| Mockup is a proprietary file outside the repo | High | Hand-translate; owner reviews the rendered result |
| Dropping template columns is irreversible per migration | Low | Additive migration first, drop last; no data of record |
| Orphaned `selectedTemplateId` after a registry edit | Low | Registry lookup falls back to the default template |

## Rollback plan

Each work unit is its own revert. Pricing, gallery, and workshop info are independent
commits; reverting the pricing unit restores the scalar `price` field end to end. The
column drop is the only one-way door — it lands last, in its own migration, so a revert
before it is pure code. After it, restoring the old branding requires a new migration
(the data was admin-entered config, not records, so loss is acceptable).

## Dependencies

- The mockup must be translated by someone who can open `Template_Catalogo.op`.
- Language rule: already on `main` in `AGENTS.md`. No merge-order dependency remains.

## Review workload forecast

Sanity-checked against the exploration's 900–1150 line estimate; unit 4 is understated
there.

| # | Work unit | Est. lines | Budget risk |
|---|---|---|---|
| 1 | Workshop contact info + `coverText` | 200–250 | Low |
| 2 | Template registry + gallery (additive) | 250–300 | Low |
| 3 | Wire registry into renderer; retire branding; logo data URI | 250–320 | Medium |
| 4 | Three-tier pricing incl. e2e | 350–430 | **High** |

`Decision needed before apply: Yes`
`Chained PRs recommended: Yes`
`400-line budget risk: High`

Unit 4 cannot be split cleanly: changing `ProductPrintRef.price` to `prices` breaks
compilation at every call site simultaneously, so any intermediate slice is a non-building
tree. If it lands over budget, it needs an accepted `size:exception`, not an artificial
split. Units 2 and 3 *can* merge into one ~500-line PR to avoid an intermediate state
holding registry code nothing calls; `sdd-tasks` should surface that choice rather than
decide it. Unit 3 carries the logo data-URI work, which is why it is estimated above the
exploration's figure.

## Success criteria

- [ ] A generated PDF shows workshop phone/WhatsApp/email/address/hours and social handles.
- [ ] The builder offers a template gallery; no font or colour picker remains.
- [ ] Every card shows three bold tiers; a `0.00` tier renders `—`, never `$0.00`.
- [ ] The cover logo renders identically in the live preview and the PDF.
- [ ] `AdaptiveCards.tsx` has a test file covering all-present, some-zero, all-zero.
- [ ] The live e2e passes against real Postgres + Chromium with three-tier fixtures.
- [ ] A spec delta records R8.1 as superseded.
