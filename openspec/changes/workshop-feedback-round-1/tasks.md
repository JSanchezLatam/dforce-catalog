# Tasks — workshop feedback, round 1

Eight PRs. The grouping is explained in `proposal.md`; the short version is that
it follows measured file overlap, not the module each item was reported under.

**Parallel-safe:** PR A, B, C, D, E, G and H share no files. **Sequential:** PR F2
must follow PR F1 — both rewrite `CatalogBuilderForm.tsx`.

---

## PR A — Price lists in the product detail  ·  **DONE** (PR #119)

`src/app/(app)/inventory/[id]/page.tsx`

The "Listas de precios" card already exists and every one of the 699 products
has the data. It renders blank because the field names do not match what the
ERP stores — verified against the dev database:

| Database | Code reads |
|---|---|
| `"Name": "Precio de venta "` | `ListName` |
| `"Precio": "40.00"` | `Price` |

- [x] Read `Name` and `Precio`. Note the **trailing space** in the ERP's names —
      `price-lists.ts:62` already trims for this reason; do the same
- [x] Test with a fixture whose shape is copied from the real row, not invented
- [x] Confirm the three tiers show: `Precio de venta`, `PRECIO TALLER`, `Precio Socio`

## PR B — Service orders: refresh button, and the 1000-row load  ·  **DONE** (#122)

`src/app/(app)/service-orders/page.tsx`

Both land in this file, so they ship together.

- [x] Refresh button on the list, calling `router.refresh()`
- [x] `listInventory({}, { offset: 0, limit: 1000 })` (`:92`) runs on **every**
      render of this page, to fill the parts picker inside a form nobody may
      open. ~132 KB per load, measured. Load it when the form opens instead
- [x] `PICKER_LIST_LIMIT = 1000` is at `:44`; the comment at `:38-43` says there
      is no dedicated parts-search route yet — read it before choosing the fix
- [x] Verify over the LAN, not localhost: this is a latency problem and
      localhost hides it

## PR C — Validation messages in Spanish  ·  **DONE** (PR #120)

`src/modules/customers/validation.ts`, `src/modules/account/service.ts`

Twelve operator-visible strings are in English, against AGENTS.md's language
rule. `Name is required`, `Phone is required`, `Phone must be a valid
international format…`, `Email must be a valid email address`, `Username is
required`, `Role must be tecnico or administrador`, `Email is already in use by
another account`, `Username is already taken`.

- [x] Translate all twelve. Rioplatense, matching the existing Spanish messages
- [x] **Tests assert the Spanish string** (AGENTS.md) — update every test that
      asserts the English one rather than loosening it to match both

## PR D — Catalog visibility  ·  **DONE** (#128)

`src/modules/auth/policy.ts`, `src/app/(app)/catalogs/page.tsx`

See `proposal.md`. Blocked on: is a catalog a personal document or a workshop
asset? If the latter, `catalogs.listAll: true` for `tecnico` is the whole fix.

- [x] Owner decides
- [x] Apply, and add the test that a técnico sees a catalog they did not generate
- [x] `route-guards.test.ts` exists to stop an endpoint appearing unguarded —
      check whether it needs a matching entry

## PR E — Page space distribution  ·  **DONE** (#124 + #126)

`src/shared/template/CatalogTemplate.tsx` (grid at :745-757)

`alignContent: "start"` packs rows to the top at their natural height, so any
page whose count cap binds before its height cap leaves the remainder blank.

- [x] Distribute the leftover space between rows. **Do not** change how many
      products fit — that is the documented bias described in `proposal.md`
- [x] Record the decision in the file, next to the existing reasoning, so the
      next reader does not "fix" it back
- [x] `productsPerPage` already accepts 1–20 (`selection.ts:37-38`), so the
      owner's 6–10 range needs no change. Confirm before touching it
- [x] **Verify in the print preview**, not on screen. jsdom evaluates no
      `@media print`; this repo has already shipped a print defect from
      checking the page instead of the preview

## PR F1 — Move the preview out of the builder  ·  **DONE** (#123)

`src/modules/catalog-builder/CatalogBuilderForm.tsx` (:737+),
`src/modules/template-config/TemplateConfigForm.tsx`

Two measured defects, not a preference:

- It is passed no `productPages`, so it defaults to `[]`
  (`CatalogTemplate.tsx:530`) and **can never show a product** — cover, index
  and contact only. Stated as intentional at `CatalogBuilderForm.tsx:743-748`
- It renders at full size, 816 × 1056 px per sheet, inside an ordinary card
  with no `transform: scale` anywhere — so it overflows its width and adds
  thousands of pixels of height under the controls

Meanwhile `template-config` has no preview at all, only a colour swatch
(`TemplateConfigForm.tsx:95-111`), and its page heading still claims "live
preview before save" (`template-config/page.tsx:8`) — stale.

- [x] Remove it from the builder
- [x] Add it to template-config, **scaled to fit**
- [x] Fix the stale heading
- [x] Preserve the authenticated logo/cover URLs: the worker inlines the same
      bytes as data URIs so the two match pixel-for-pixel
      (`CatalogBuilderForm.tsx:752-763`, `specs/workshop-settings/spec.md:133-145`)

## Follow-up from F1 — English copy on `/template-config`

`src/app/(app)/template-config/page.tsx` renders `Template configuration` and
`You do not have permission to view this page.` in English, against AGENTS.md's
language rule; every neighbouring page is Spanish. It predates F1 and was left
out of it deliberately rather than folded in as silent scope.

- [ ] Translate both, and check the other `(app)` pages for the same pattern

## PR F2 — Catalog selection  ·  **DONE** (#125)

`src/modules/catalog-builder/CatalogBuilderForm.tsx`

One root cause behind all three reported symptoms. Every fetched candidate is
**auto-selected** (`:186`), so picking 12 of 188 is really discarding 176 —
which is why the operator sets the page size to "Todos" (`:485`), which is why
the action button ends up ~188 rows down (it is the third card, `:605-643`, and
nothing on this page is sticky).

- [x] Do not preselect everything. Keep the id-handoff from `/inventory`
      preselected — that one the operator did choose
- [x] Sticky action bar: count + button, visible regardless of scroll position
- [x] "Deselect those without an image". `product.image` already carries this
      (`queries.ts:46`). **`imageType` cannot be used** — a product with no
      images maps to `low_res`, not to a distinct state (`mapper.ts:35-44`)
- [x] Surface `MAX_TOTAL_PRODUCTS = 200` before the operator hits Continue —
      today it is only enforced at continue time (`selection.ts:208-210`), and
      188 auto-selected sits just under it invisibly
- [x] The 200 cap is enforced in three places on purpose (`selection.ts:66-77`).
      Do not relocate it

## PR G — `useUrlFilters`: filters lost on back-navigation  ·  **CLOSED, no defect**

Reproduced in a browser against the real catalog before writing anything, which
is what the task said to do: filter `/inventory` by name, open a product from
the row menu, press the browser's Back button. **The filter came back** — URL,
input value and filtered rows. The owner confirms it behaves for them too.

So `useUrlFilters` never had this defect, and it is worth saying why that
mattered: `CustomerFilters.tsx` documents two shipped-and-reverted attempts at
this hook. Going straight to a fix would have been the third, against a bug that
was not there.

- [x] Reproduce first
- [x] Establish the cause with evidence — there is no defect to explain
- [x] Closed without touching the hook

### One real thing found while reproducing, not fixed

The product detail's breadcrumb is `<Link href="/inventory" />`
(`inventory/[id]/page.tsx:72`) — the bare path, with no search params. Going
"back" that way does drop the filter, and it sits top-left where "back" is
expected.

Not built: the owner reports the flow works for them, so nobody is currently
hurt by it, and inventing work from a hypothesis is how the two reverted
attempts happened. If it ever gets reported, the same pattern is in the
customers, service-orders and vehicle breadcrumbs — check all four, not one.

## PR H — `StatusBadge` sizing  ·  **DONE** (#132)

`src/shared/ui/StatusBadge.tsx`

Reported as "the sync badge is not the same size as the button". The component
is used by seven surfaces — catalogs, inventory sync, users, service orders
(list and detail), customers, vehicles — so a change inside it is app-wide.

- [x] Decide whether the fix belongs in the badge or beside the one button that
      looks wrong. Prefer the narrower one unless every surface is wrong
- [x] AGENTS.md's 44×44 rule applies to action controls; a badge is not one, but
      whatever sits beside it is
- [x] Check all seven surfaces after

---

## The stock badge — located and fixed (#132)

It was on the product DETAIL page, not the list: `{product.stock} en stock` at
`inventory/[id]/page.tsx:87`. The reason a grep for it failed is that the only
`En stock`/`Sin stock` strings in the code are the filter dropdown's options —
the badge composes its label from the number. Found by opening the page.

Measured rather than eyeballed, and worse than reported: the destructive badge
variant was **3.30:1 in light** and **1.80:1 in dark**, both under AA. Fixed in
the variant, since both of its call sites had it.
