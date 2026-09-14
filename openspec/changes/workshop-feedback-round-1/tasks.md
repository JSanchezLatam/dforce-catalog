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

## PR B — Service orders: refresh button, and the 1000-row load  ·  *independent*

`src/app/(app)/service-orders/page.tsx`

Both land in this file, so they ship together.

- [ ] Refresh button on the list, calling `router.refresh()`
- [ ] `listInventory({}, { offset: 0, limit: 1000 })` (`:92`) runs on **every**
      render of this page, to fill the parts picker inside a form nobody may
      open. ~132 KB per load, measured. Load it when the form opens instead
- [ ] `PICKER_LIST_LIMIT = 1000` is at `:44`; the comment at `:38-43` says there
      is no dedicated parts-search route yet — read it before choosing the fix
- [ ] Verify over the LAN, not localhost: this is a latency problem and
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

## PR D — Catalog visibility  ·  *independent, needs an owner decision first*

`src/modules/auth/policy.ts`, `src/app/(app)/catalogs/page.tsx`

See `proposal.md`. Blocked on: is a catalog a personal document or a workshop
asset? If the latter, `catalogs.listAll: true` for `tecnico` is the whole fix.

- [ ] Owner decides
- [ ] Apply, and add the test that a técnico sees a catalog they did not generate
- [ ] `route-guards.test.ts` exists to stop an endpoint appearing unguarded —
      check whether it needs a matching entry

## PR E — Page space distribution  ·  *independent, renegotiates a decision*

`src/shared/template/CatalogTemplate.tsx` (grid at :745-757)

`alignContent: "start"` packs rows to the top at their natural height, so any
page whose count cap binds before its height cap leaves the remainder blank.

- [ ] Distribute the leftover space between rows. **Do not** change how many
      products fit — that is the documented bias described in `proposal.md`
- [ ] Record the decision in the file, next to the existing reasoning, so the
      next reader does not "fix" it back
- [ ] `productsPerPage` already accepts 1–20 (`selection.ts:37-38`), so the
      owner's 6–10 range needs no change. Confirm before touching it
- [ ] **Verify in the print preview**, not on screen. jsdom evaluates no
      `@media print`; this repo has already shipped a print defect from
      checking the page instead of the preview

## PR F1 — Move the preview out of the builder  ·  *before F2*

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

- [ ] Remove it from the builder
- [ ] Add it to template-config, **scaled to fit**
- [ ] Fix the stale heading
- [ ] Preserve the authenticated logo/cover URLs: the worker inlines the same
      bytes as data URIs so the two match pixel-for-pixel
      (`CatalogBuilderForm.tsx:752-763`, `specs/workshop-settings/spec.md:133-145`)

## Follow-up from F1 — English copy on `/template-config`

`src/app/(app)/template-config/page.tsx` renders `Template configuration` and
`You do not have permission to view this page.` in English, against AGENTS.md's
language rule; every neighbouring page is Spanish. It predates F1 and was left
out of it deliberately rather than folded in as silent scope.

- [ ] Translate both, and check the other `(app)` pages for the same pattern

## PR F2 — Catalog selection  ·  *after F1*

`src/modules/catalog-builder/CatalogBuilderForm.tsx`

One root cause behind all three reported symptoms. Every fetched candidate is
**auto-selected** (`:186`), so picking 12 of 188 is really discarding 176 —
which is why the operator sets the page size to "Todos" (`:485`), which is why
the action button ends up ~188 rows down (it is the third card, `:605-643`, and
nothing on this page is sticky).

- [ ] Do not preselect everything. Keep the id-handoff from `/inventory`
      preselected — that one the operator did choose
- [ ] Sticky action bar: count + button, visible regardless of scroll position
- [ ] "Deselect those without an image". `product.image` already carries this
      (`queries.ts:46`). **`imageType` cannot be used** — a product with no
      images maps to `low_res`, not to a distinct state (`mapper.ts:35-44`)
- [ ] Surface `MAX_TOTAL_PRODUCTS = 200` before the operator hits Continue —
      today it is only enforced at continue time (`selection.ts:208-210`), and
      188 auto-selected sits just under it invisibly
- [ ] The 200 cap is enforced in three places on purpose (`selection.ts:66-77`).
      Do not relocate it

## PR G — `useUrlFilters`: filters lost on back-navigation  ·  *shared, alone*

`src/shared/ui/filters/useUrlFilters.ts`

**Cause not established. Do not start by writing a fix.** The filters do live in
the URL and the state is seeded from it on mount (`:43`, lazily and on purpose —
see the comment). Reproduce in a browser first; `CustomerFilters.tsx` documents
two previously shipped-and-reverted attempts at this hook, so the ground is
known to be treacherous.

- [ ] Reproduce: search, open a product, go back
- [ ] Establish the cause with evidence before changing anything
- [ ] Fix, then check **all four** consumers: inventory, customers, service
      orders, and the vehicle make/model picker

## PR H — `StatusBadge` sizing  ·  *shared, alone*

`src/shared/ui/StatusBadge.tsx`

Reported as "the sync badge is not the same size as the button". The component
is used by seven surfaces — catalogs, inventory sync, users, service orders
(list and detail), customers, vehicles — so a change inside it is app-wide.

- [ ] Decide whether the fix belongs in the badge or beside the one button that
      looks wrong. Prefer the narrower one unless every surface is wrong
- [ ] AGENTS.md's 44×44 rule applies to action controls; a badge is not one, but
      whatever sits beside it is
- [ ] Check all seven surfaces after

---

## Not started: the stock badge

> "El badge de Stock se ve muy tímido y no se aprecia bien en modo oscuro"

**Could not locate it.** The only `En stock` / `Sin stock` strings in the code
are the filter dropdown's options (`InventoryFilters.tsx:121-122`), not a badge
on a row. Needs the owner to say which screen shows it before this can be
scoped — deliberately not guessed.
