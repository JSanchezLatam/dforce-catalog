# Design: Catalog Templates and Workshop Info

Phase: `sdd-design` · Store: hybrid (Engram `sdd/catalog-templates-and-workshop-info/design` + this file)

## Technical Approach

Three seams, one renderer. A code registry owns typography/colour/card markup; `workshop_config`
owns logo and contact text; `ProductPrintRef` carries three tiers instead of one. `CatalogTemplate`
stays the single renderer for preview and PDF (Risk-5) — every change below extends its props or
resolves data *before* calling it, never forks it.

## Architecture Decisions

### D1 — Registry contract: tokens + one `Card` seam

**Choice.** `src/shared/template/registry.ts` exports one array of `CatalogTemplateDef`; each entry
lives in its own file and supplies design tokens plus a single card component.

```ts
export type CatalogTemplateDef = {
  id: string;                    // persisted as template_config.selected_template_id
  name: string;                  // gallery label
  thumbnail: string;             // /public/templates/<id>.png
  font: string;
  primaryColors: { primary: string; secondary: string };
  Card: (props: { product: ProductPrintRef; imageHandling: "strict" | "adaptive" }) => React.ReactElement;
};
export const CATALOG_TEMPLATES: CatalogTemplateDef[] = [dforceClassic];
export const DEFAULT_TEMPLATE_ID = "dforce-classic";
export function getTemplate(id?: string | null): CatalogTemplateDef; // never returns null
```

`CatalogTemplate` calls `getTemplate(branding.templateId)` and delegates each card to
`template.Card`; today's `pickCard` strict/adaptive branch moves *into* `dforceClassic.Card`, which
keeps wrapping `AdaptiveCards`. Cover and index structure stay in `CatalogTemplate`.

**Alternatives rejected.** A `templates` DB table (builds a template engine for one template);
making cover/index pluggable now (a second seam with no second consumer).

**Rationale.** Adding template #2 = one new file + one array element. It touches neither
`dforceClassic` nor `CatalogTemplate`. If #2 needs a different cover, adding an optional
`Cover?` seam is still additive and still does not touch #1 — that is the property being bought,
not a pre-built abstraction.

### D2 — Branding split, and two branding shapes

**Choice.** The renderer prop keeps its name and shrinks; the queue payload gets its own type.

```ts
// CatalogTemplate.tsx — what the renderer consumes
export type CatalogTemplateBranding = {
  templateId: string;
  logoUrl: string | null;   // http path (preview) | data: URI (worker)
  coverText: string | null;
};
// enqueue.ts — what crosses pg-boss
export type PdfBranding = {
  templateId: string;
  logoR2Key: string | null;
  logoContentType: string | null;
  coverText: string | null;
};
```

Call sites: `CatalogBuilderForm.tsx` passes `{ templateId: templateConfig?.selectedTemplateId,
logoUrl: "/api/workshop-config/logo", coverText: workshopConfig?.coverText }` — `builder/page.tsx`
is already a server component and adds a `getWorkshopConfig()` read. `generate/route.ts` builds
`PdfBranding` from `getWorkshopConfig()` + `getTemplateConfig()`.

**Alternatives rejected.** One shared type with an optional `logoR2Key` (a renderer field the
renderer must never read); passing base64 in the payload (`worker.ts:15-16` forbids it).

**Rationale.** The renderer stays unaware of R2. The divergence is deliberate and one function wide.

### D3 — Logo resolution lives in `renderPdfBuffer`

**Choice.** `renderPdfBuffer` (worker.ts) resolves the key immediately before `renderCatalogHtml`:
`getObject(key)` → `data:${contentType ?? "image/png"};base64,${buf.toString("base64")}`.
`getObject` returning `null` (`r2.ts:37`, already null-not-throw) yields `logoUrl: null`; the cover
renders no `<img>` and the job completes. A missing logo never fails a job that has already consumed
one of three queue slots. Preview does nothing special — the browser fetches the authenticated route
with its session cookie.

**Alternatives rejected.** Resolving at enqueue time (multi-MB base64 in JSONB); throwing on a
missing object (turns a cosmetic gap into a lost catalog).

### D4 — Three tiers: one object, one render-site guard

```ts
export type ProductPrices = { venta: number | null; taller: number | null; socio: number | null };
// ProductPrintRef: `price?: number | null` → `prices?: ProductPrices | null`
```

`isPrintProduct` (`generate/route.ts`) validates each tier individually — this is the only guard
between a malformed payload and a `TypeError` in a decoupled worker:

```ts
const isTier = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));
if (p.prices != null) {
  if (typeof p.prices !== "object" || Array.isArray(p.prices)) return false;
  const t = p.prices as Partial<ProductPrices>;
  if (!isTier(t.venta) || !isTier(t.taller) || !isTier(t.socio)) return false;
}
```

`AdaptiveCards` gets one `ProductPrices` component (replacing `ProductPrice`), shared by both cards
so the two never format money differently. It renders three labelled rows, bold, always all three.
The em-dash rule is `value == null || value <= 0 → "—"` — deliberately re-guarding `<= 0` at the
render site even though `resolvePrice` already maps `0.00` to `null`, because a hostile payload
reaching the worker must not be able to print `$0.00` next to a product. Row labels
("Venta"/"Taller"/"Socio") are a local constant: importing `PRICE_LIST_LABELS` from
`modules/catalog-builder` would invert the `shared ← modules` dependency direction, and the card
needs shorter labels than the selector did.

`queries.ts` and `resolvePrice` are untouched — they already produce all three tiers with `0.00`
collapsed. Only `CatalogBuilderForm`'s `reviewedProducts` changes: stop destructuring `priceLists`
off, emit `prices: resolveAllPrices(priceLists)`.

### D5 — Two migrations, additive first

| # | Lands with | Content |
|---|---|---|
| `0008_*` | WU1 | `workshop_config` + `phone, whatsapp, email, address, website, hours, cover_text` (nullable text) and `social_handles` (jsonb); `template_config` + `selected_template_id` (nullable text); one hand-appended `UPDATE workshop_config SET cover_text = (SELECT cover_text FROM template_config LIMIT 1) WHERE cover_text IS NULL` |
| `0009_*` | WU3 (last) | `template_config` DROP `logo_url, primary_colors, font, cover_text` |

Every added column is nullable, so the one live `workshop_config` row and both catalogs survive with
no backfill; `selected_template_id` NULL resolves through `getTemplate(null)` to the default. The
single `UPDATE` preserves the owner's already-typed cover text rather than discarding it. Migrations
are timestamp-ordered through `meta/_journal.json` (currently at `0007_famous_tusk`) and an applied
migration is never edited — the split therefore has to be planned now, not discovered later. Keeping
the drop in its own last migration is what makes the proposal's rollback plan true: every revert
before `0009` is pure code.

## Data Flow

```
                       registry.ts (font, colours, Card)
                              │
workshop_config ──┬─ coverText ┴──→ CatalogTemplateBranding ──→ CatalogTemplate ──→ AdaptiveCards
                  │                        ↑            ↑
                  │        /api/workshop-config/logo    │  (preview: CatalogBuilderForm)
                  └─ logoR2Key ─→ PdfBranding ─→ pg-boss ─→ renderPdfBuffer
                                                              └ getObject(key) → data: URI
producto.raw.PriceLists → queries.ts → resolveAllPrices → prices{venta,taller,socio}
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/shared/template/registry.ts` | Create | `CatalogTemplateDef`, `CATALOG_TEMPLATES`, `getTemplate` fallback |
| `src/shared/template/templates/dforce-classic.tsx` | Create | First entry; hand-translated from `Template_Catalogo.op` |
| `src/shared/template/registry.test.ts` | Create | Unknown id → default; ids unique |
| `src/shared/template/AdaptiveCards.test.tsx` | Create | Closes the money-rendering gap |
| `src/shared/template/CatalogTemplate.tsx` | Modify | Branding shrinks; `prices`; delegates to `template.Card` |
| `src/shared/template/AdaptiveCards.tsx` | Modify | `ProductPrice` → three-row `ProductPrices` |
| `src/shared/db/schema.ts`, `migrations/0008_*`, `0009_*` | Modify/Create | See D5 |
| `src/modules/workshop-config/{service,WorkshopConfigForm}.tsx` | Modify | Contact fields via the existing `"field" in parsed` partial-touch upsert |
| `src/modules/template-config/{service,TemplateConfigForm}.tsx` | Modify | Branding inputs → gallery picker |
| `src/modules/pdf-generation/{enqueue,worker,render}.ts` | Modify | `PdfBranding`; data-URI resolution; `render.ts` font from `getTemplate` |
| `src/modules/catalog-builder/{CatalogBuilderForm.tsx,price-lists.ts}` | Modify | Tier dropdown removed; `resolveAllPrices` |
| `src/app/api/catalog-builder/generate/route.ts` | Modify | `isPrintProduct` rewrite; branding assembly |
| `src/app/(app)/builder/page.tsx` | Modify | Also reads `getWorkshopConfig()` |
| `src/modules/pdf-generation/render.test.ts` | Modify | "product prices" block (from line 128) rewritten |
| `src/app/api/catalog-builder/generate/route.test.ts` | Modify | ~10 shape assertions rewritten + per-tier RED tests |
| `src/e2e/full-flow.e2e.test.ts` | Modify | Three-tier fixtures |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (jsdom) | `AdaptiveCards` money rendering | NEW file. All three present; one tier null → `—`; all null → three `—`; hostile `0` → `—`, never `$0.00`; both card variants identical |
| Unit (node) | `isPrintProduct` trust boundary | One RED test per tier field, plus non-object, array, `NaN`, `Infinity` |
| Unit (node) | Registry fallback | Unknown/NULL id → `DEFAULT_TEMPLATE_ID` |
| Unit (node) | `render.ts` | Body font resolves from the registry, not `branding.font` |
| Unit (node) | `workshop-config` service | New fields honour the partial-touch upsert; each validator |
| **Live smoke (required, not unit)** | Three-tier price SQL; new `workshop_config` columns; logo data URI in a real PDF | Per `AGENTS.md`: the injected-dep seam means a green suite *proves* zero real-SQL coverage. Run `src/e2e/full-flow.e2e.test.ts` against real Postgres + Chromium before merging **WU1** and **WU4**, and generate one PDF by hand to confirm the cover logo. `renderPdfBuffer` has no unit coverage by design — the data-URI path is verifiable only live |

## Threat Matrix

N/A — no routing change (no new or removed routes), no shell, no new subprocess (Playwright's
Chromium launch is untouched), no VCS/PR automation, no executable-file classification. The one
security-relevant boundary, the pg-boss payload, is covered by the D4 `isPrintProduct` tests above.

## Work-Unit Boundaries

| # | Unit | Est. | Risk |
|---|---|---|---|
| 1 | Workshop contact info + `coverText` + migration `0008` | 200–250 | Low |
| 2 | Registry + gallery picker + persisted id (additive, unwired) | 250–300 | Low |
| 3 | Wire registry into renderer; branding split; logo data URI; retire branding form; migration `0009` | 300–380 | Medium |
| 4 | Three-tier pricing + `AdaptiveCards.test.tsx` + e2e | 350–430 | High |

`Decision needed before apply: Yes` · `Chained PRs recommended: Yes` · `400-line budget risk: High`

**On the proposal's "unit 4 cannot be split" claim — partially refuted.** As literally stated it is
true of a *rename*: `price` → `prices` breaks every call site at once. But renaming is not the only
sequencing. Adding `prices?` alongside `price?`, shipping the renderer and builder against it, then
deleting `price` last, compiles at every step. The cost is a dual-shape renderer branch plus tests
for a state nobody wants, then deleting them, and a live half-state where the payload carries one
tier while the renderer expects three. **Recommendation: do not split.** Take `size:exception` if it
overruns — the throwaway code costs a reviewer more than the extra 30 lines.

**On merging units 2+3** (the proposal left this open): keep them separate. With `0009` now in unit
3, a merged PR is 550–680 lines. The intermediate state is not broken — the gallery persists an id
nothing reads yet, which is a feature flag by omission, not dead code.

## New Risks (not in the proposal)

1. **`render.ts:49` reads `props.branding?.font`** for the PDF document body font. Once font moves
   into the registry, `renderCatalogHtml` must resolve `getTemplate(...)` too, or the body silently
   falls back to `sans-serif` while the cover uses the template font. Covered by an explicit test.
2. **In-flight jobs across the WU3 deploy** carry the old branding shape and reach the new worker.
   Max queue depth is 3 (`MAX_QUEUE_DEPTH`) — drain the queue before deploying WU3.
3. **`template_config.logo_url/primary_colors/font/cover_text` are `NOT NULL`.** Between `0008` and
   `0009` the picker can only *extend* the form; `saveTemplateConfig` must keep supplying those four
   or the upsert fails. WU2's picker cannot delete the branding inputs — WU3 does.
4. **Three price rows raise card height** while `chunkProducts` splits by fixed count, never by
   measured height. Pages may overflow. Only visible in a real PDF — folded into the WU4 live smoke.

## Open Questions

- [ ] None blocking. `Template_Catalogo.op` still needs a human translator (proposal dependency),
      but the registry contract in D1 is what that translation targets, so tasks are not blocked.
