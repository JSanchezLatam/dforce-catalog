# Proposal: table-redesign-bulk-actions

## Intent

The complaint that started this was visual. The owner pasted a shadcn data-table
reference and said our four list tables — Clientes, Inventario, Órdenes de
servicio, Gestión de usuarios — do not look like that. They are correct: our
tables are bare `<table>` markup inside a generic `Card`, the actions column is
a single "Ver" link, and there is no way to act on more than one row at a time.

Be honest about the split: **three of the four items are cosmetic, and the
fourth is a real feature with a real safety surface.**

| Item | What it really is |
|---|---|
| Rounded bordered container + shaded header | Cosmetic. No behaviour, no test, verified by opening a browser. |
| Badges on enum columns | Cosmetic, and mostly already done (see Out of Scope). |
| Per-row kebab menu | Cosmetic *plus* an accessibility fix — two of the four "Ver" links are 28px, below AGENTS.md's 44x44 rule. |
| Checkbox selection + bulk actions | A genuine feature. It can deactivate every administrator, cancel the wrong service order, or act on rows the operator believes they filtered away. |

**Success looks like**: the four tables read as one component instead of four
near-copies; a técnico ticks eight customers on page 1, three more on page 3,
sees a bar that tells them what is selected off-screen, runs one action, and
gets back a list naming exactly which rows did not apply and why.

## Blocked on

**PRs #83/#84/#85/#86 (`table-column-sorting`) must land first.** All four page
files are open in those PRs; every file:line below is read from the merged
preview at `preview/table-sorting-all`, i.e. the post-sorting shape. Starting
implementation before they merge guarantees a conflict in exactly the four files
this change rewrites.

## What Changes

### 1. The table shell — `src/components/ui/table.tsx`, applied once

`Table` today renders a bare `overflow-x-auto` div with no border and no header
fill (`table.tsx:7-20`), and `TableHeader` only adds a bottom border
(`table.tsx:22-30`). The container and the shaded header go here, not into four
pages.

**This is not a free one-liner, and the spec must settle it.** All four tables
are already wrapped in `<Card size="sm"><CardContent>` (`customers/page.tsx:223`,
`inventory/page.tsx:117`, `service-orders/page.tsx:124`), so adding a border and
radius inside `Table` produces a **double border**. Either `Table` owns the
container and the four pages drop their `Card` wrapper, or the `Card` stays and
`Table` only gains the shaded header. Pick one in the spec.

`table.tsx` has **six other consumers** beyond the four: `customers/[id]`
vehicles, `service-orders/[id]`, `vehicles/[vehicleId]`, `CatalogBuilderForm`,
`CustomerPicker`, and three `loading.tsx` skeletons. Several sit inside a dialog
or a form where a second bordered box is wrong. Every one of them must be looked
at, not assumed.

### 2. Kebab row-action menu — all four tables

Row actions today: customers = one "Ver" link (`customers/page.tsx:277-283`),
inventory = one (`inventory/page.tsx:145-150`), service-orders = one
(`service-orders/page.tsx:154-159`), users = two, `UserFormTrigger` +
Desactivar/Reactivar (`UsersTable.tsx:214-228`).

- `dropdown-menu.tsx` wraps `@base-ui/react/menu` and **portals**. jsdom sees
  the portal, but the RSC boundary it needs is a different story — see Risks.
- **The kebab trigger lands at `min-h-11 min-w-11`.** Inventory's and
  service-orders' current links are `h-7` = 28px, in violation of AGENTS.md's
  44x44 rule; customers' was already fixed. Do not inherit `h-7` into the new
  trigger.
- Test cost is concentrated in **one file**: `UsersTable.test.tsx` has 12
  button-name assertions that break; customers' page test has 1; inventory and
  service-orders have 0.

### 3. Selection column and bulk actions

`table.tsx` already carries shadcn's checkbox-column affordances —
`data-[state=selected]:bg-muted` on `TableRow` (`table.tsx:60`) and
`[&:has([role=checkbox])]:pr-0` on `TableHead`/`TableCell` (`table.tsx:73,86`) —
and `src/components/ui/checkbox.tsx` already exists. **No new primitive is
needed for the checkbox column.**

**Selection persists across pages, held in client state.** Not per-page-only,
not a server-side "select all N matching the filter". Two consequences are
obligations of this change, not discoveries for later:

1. **The counter can read "12 seleccionados" with 3 rows on screen.** Printing a
   number is not enough; the bar must make the off-screen part of the selection
   legible (a way to see or clear what is selected but not visible).
2. **Changing a filter leaves selected rows that no longer match it.** A
   selection of 12 that silently includes rows the operator filtered away is how
   a bulk action hits the wrong row. The spec must choose: **keep, drop, or
   warn** — and the choice must be visible on screen, not implicit. This is the
   sharpest edge in the change.

On `/users` the "pages" framing does not apply — that table has **no pagination
at all**; it holds every row client-side. Its equivalent hazard is the
`Mostrar inactivos` checkbox (`UsersTable.tsx:102,110`): unticking it hides rows
that stay selected. Same rule, different trigger.

**Partial success, per row, with its reason.** Not all-or-nothing. "2 no se
pudieron" with no names is useless on a 40-row selection; the result must name
the row and the reason. `UsersTable.tsx:94-99` already maps `last_active_admin`,
`self_deactivate`, `self_role_change` and `not_found` to Spanish sentences —
that map is the model, promoted from a single banner to a per-row list.

Three actions, one per table shape:

| Table | Bulk action | Per-row rule that must be re-evaluated per row |
|---|---|---|
| Clientes | Activar / Desactivar | `deactivateCliente`/`reactivateCliente`, routed today through `PATCH /api/customers/[id]` with `{active}` (`api/customers/[id]/route.ts:100-112`) |
| Gestión de usuarios | Activar / Desactivar | `checkAdminSafety` — see Risks, this is the one that can break the app |
| Órdenes de servicio | Cambiar estado | `assertTransition(from, to)` (`transitions.ts:36`), evaluated against each row's **current** status |
| Inventario | Enviar al generador de catálogos | No per-row rule; a new integration, see §4 |

**The bulk implementation loops the existing per-row service function
sequentially.** It does not compute a precondition set once and iterate. It
writes no new SQL, which also keeps it out of AGENTS.md's injected-seam blind
spot. See Risks for why this is non-negotiable.

Worth settling in design: the client already loops HTTP today —
`UsersTable.toggleActive` PATCHes `/api/users/{id}` one row at a time and maps
the refusal reason (`UsersTable.tsx:122-150`). A sequential client-side loop over
the **existing** per-row routes delivers per-row semantics, per-row reasons and
partial success with zero new server code. The cost is N round trips on a
workshop tablet and no server-side progress or cancellation. New bulk endpoints
buy those back at the price of new routes. Open question below.

For service-orders, `getAllowedTransitions` already exists
(`transitions.ts:45`) — the status menu can offer only the transitions legal for
the whole selection instead of offering everything and reporting failures.

### 4. Inventario → generador de catálogos

**This is new integration work, not reuse.** `POST /api/catalog-builder/products`
accepts `categories` only (`api/catalog-builder/products/route.ts:21-24`), and
`CatalogBuilderForm`'s selection model is category-tree plus exclude-only
(`selection.ts`). There is no path today to seed the builder with a product-id
list. Both a handoff transport and a second selection mode in the builder have to
be built.

## What Does NOT Change

- **`StatusBadge` (`src/shared/ui/StatusBadge.tsx`) stays exactly as it is.** It
  already badges `orden.status` (`service-orders/page.tsx:149`) and is used in 8
  places. It is a different visual system from `components/ui/badge.tsx`
  (rounded-full pill + icon vs shadcn bordered pill). Migrating it is a wider
  blast radius than this whole change; it is **out of scope**, and the two
  systems coexist.
- **Inventory gets no badge.** Its rendered columns (ID / Name / Category L1 /
  Category L2, `inventory/page.tsx:140-143`) are free Interfuerza text with no
  small-cardinality enum. `stockStatus` is a **filter**, not a column
  (`inventory-view/queries.ts:20,52,57,83-84`); badging it means adding a column,
  which is new scope.
- **No server-side "select all N matching the filter".** Named as a follow-up
  below, deliberately not folded in.
- No change to what any row action *does* — the kebab relocates existing
  actions, it does not add new single-row ones.
- No stock, pricing, or sync behaviour anywhere near this change.

## Known limitation, accepted

Without server-side select-all, building a catalog from a large inventory
selection means ticking rows across up to ~70 pages. That makes the
inventory → generador item materially less useful than it could be. The owner
accepted this. **The natural follow-up change is a server-side "seleccionar los
N que coinciden con el filtro"**; it does not belong in this change, and
`tasks.md` must carry it as a follow-up rather than letting it leak in.

## Capabilities

### New Capabilities

- `table-bulk-actions`: the shared list-table contract — visual shell, kebab row
  actions at 44x44, cross-page selection model, the filter-vs-selection rule,
  and per-row partial-success reporting.

### Modified Capabilities

- `customer-management`: bulk activate/deactivate from the list
  (`openspec/specs/customer-management/spec.md`).
- `service-orders`: bulk status change, constrained per row by
  `assertTransition` (`openspec/specs/service-orders/spec.md`).
- `catalog-generation`: a second entry point, seeded by a product-id selection
  from `/inventory` (`openspec/specs/catalog-generation/spec.md`).
- `user-management`: bulk activate/deactivate under the admin-floor invariant.
  **Note for sdd-spec**: this capability has no file in `openspec/specs/` — its
  only spec lives at
  `openspec/changes/archive/crm-shell-settings-rbac/specs/user-management/spec.md`
  and was never merged into the baseline. Read it there.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/components/ui/table.tsx` | Modified | container + shaded header, once; 10 consumers |
| `src/app/(app)/customers/page.tsx` | Modified | kebab, checkbox column, client selection boundary |
| `src/app/(app)/inventory/page.tsx` | Modified | same, plus the generador handoff |
| `src/app/(app)/service-orders/page.tsx` | Modified | same, plus bulk status |
| `src/modules/account/UsersTable.tsx` | Modified | kebab + selection; already `"use client"` |
| `src/modules/account/UsersTable.test.tsx` | Modified | 12 button-name assertions |
| New shared selection component/hook | New | selection state, bar, per-row result panel |
| `src/modules/catalog-builder/*`, `api/catalog-builder/products` | Modified | accept a product-id list beside the category model |
| 3 `loading.tsx` skeletons, `CatalogBuilderForm`, `CustomerPicker`, 3 detail sub-tables | Verify | inherit the `table.tsx` shell; several sit in dialogs |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **A bulk user-deactivate zeroes out the administrators.** `deactivateUser()` is race-safe *only* because it re-queries `activeAdminIds` fresh inside its own transaction, per call, before `checkAdminSafety` (`account/service.ts:468-475`). A bulk endpoint that reads the active-admin list once and loops evaluates every row against the **stale pre-batch** list — a selection containing every admin passes every check and leaves the app with zero administrators, locked out. | High | **Binding: loop the existing per-row `deactivateUser()` sequentially.** No batched precondition read, no `UPDATE … WHERE id IN (…)`. A test must assert that selecting both remaining admins deactivates exactly one and refuses the second with `last_active_admin`. |
| **A bulk action fires on rows the operator filtered away.** Selection outlives the filter by design. | High | The keep/drop/warn rule is a spec requirement, must be visible on screen, and must have its own test. |
| **A bulk status change silently succeeds on some rows and not others.** `assertTransition` is per-row-from-status: `open` + `done` both set to `in_progress` legally succeeds for one and throws for the other. | High | Per-row loop over the single-row service; per-row reason in the result. Prefer offering only transitions legal for the whole selection via `getAllowedTransitions`. |
| **A hand-written bulk `UPDATE` would land in the injected-seam blind spot.** AGENTS.md: every unit test supplies the dep, so a fully green suite *proves* zero real-SQL coverage. | Medium | Writing no new SQL removes the risk entirely. If any new SQL appears, it needs a throwaway-Postgres smoke test before merge. |
| **New `"use client"` boundaries around three Server Components.** Customers, inventory and service-orders have no client boundary at table level. This is the exact defect class AGENTS.md documents — a function crossing the RSC boundary makes the page not render, and jsdom cannot see it. The kebab also portals. | High | Browser verification per unit is **the** verification, not optional. Only ids cross the boundary; no functions, no `typeof document` render gates. |
| **"12 seleccionados" with 3 rows visible reads as a bug.** | Medium | The bar must expose the off-screen selection, not just count it. |
| **Users bulk on a mixed selection is ambiguous** — one action label over rows that need opposite operations. | Medium | Spec must define it: either two explicit actions applied only to eligible rows, or one action with the ineligible rows reported per row. |
| **The `Card` double-border question gets answered by accident** in whichever unit lands first. | Medium | Settled in the spec before WU1, not during it. |
| **Inventory's page copy is in English** — "Inventory", "No products found", "Clear filters", "Category L1" (`inventory/page.tsx:74,105-110,213`), against AGENTS.md's Spanish rule. Adding a Spanish bulk bar and kebab there ships a half-translated screen. | Medium | Not this change's job to fix. Name it in `tasks.md` as a follow-up and accept the mix, or translate the page in its own change. Do not silently expand scope. |
| **The kebab hides actions behind a click** on a tablet used one-handed. | Low | 44x44 trigger; keep the action count small enough that the menu is a menu, not a drawer. |

## Work-Unit Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2,080 |
| Review budget (this session) | 800 lines per PR |
| 800-line budget risk | High (total), Low per unit |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain, matching `crm-shell-settings-rbac` and `crm-workshop-management` |

Decision needed before apply: No (auto-chain, cached at session start)
Chained PRs recommended: Yes
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | Est. lines | Depends on |
|---|---|---|---|
| 1 | `table.tsx` shell (container + shaded header), `Card`-vs-`Table` container decision applied, all 10 consumers checked incl. 3 skeletons and the two in-dialog tables | ~120 | tracker |
| 2 | Kebab on customers / inventory / service-orders — new `RowActions`, 44x44 trigger replacing the two `h-7` links, 1 customers test assertion | ~200 | 1 |
| 3 | Kebab on users — `UsersTable` action cell + the 12 concentrated test assertions | ~190 | 2 |
| 4 | Selection primitive on **customers only**: client boundary, checkbox column, select-all-on-page, selection bar with off-screen legibility, the filter-change rule | ~450 | 2 |
| 5 | Bulk activar/desactivar for customers + users, per-row result panel, admin-floor refusal mapping | ~380 | 3, 4 |
| 6 | service-orders selection + bulk status change via `getAllowedTransitions`, per-row transition failures | ~320 | 4 |
| 7 | Inventory selection + envío al generador (handoff transport, then builder-side product-id mode) | ~420 | 4 |

```
tracker (draft, no-merge)
  └── 1 shell ── 2 kebab ─┬─ 3 users kebab ─┐
                          └─ 4 selection ───┴─ 5 bulk activate
                                            ├─ 6 orders status
                                            └─ 7 inventory → catálogo
```

**Why seven and not the exploration's five.** Two changes:

- **The kebab splits from users' kebab.** The three server-rendered tables cost
  ~1 test assertion between them; `UsersTable.test.tsx` costs 12. Merged, the
  diff is 200 lines of straightforward work with 150 lines of test churn buried
  in it, and a reviewer skims the part that actually breaks.
- **The selection primitive splits from the bulk mutations.** The
  filter-vs-selection rule and the off-screen-selection affordance are the two
  decisions most likely to be got wrong, and they are pure UI with no mutation
  risk. Landing them on one table first means three more tables inherit a rule
  that was already reviewed on its own, instead of three reviewers each
  re-litigating it next to a destructive action.

**Should unit 7 split again? Not up front — pre-declare the split point.**
At ~420 it fits the 800 budget as one PR, and splitting a genuinely new
integration before its design exists risks a 7a that ships a transport nothing
consumes. Pre-declare, in the shape `crm-shell-settings-rbac` used for its PR3:
**7a** = inventory selection + handoff transport; **7b** = builder accepts a
product-id list beside its category/exclude model. `sdd-tasks` re-forecasts and
takes the split if 7 exceeds ~500.

Units 1 and 2 can merge into a single PR (~320) if the owner prefers fewer. Kept
apart because unit 1 has **no test coverage at all** — no test asserts table
chrome — so its only verification is a browser, and burying that in a larger diff
is how it gets skipped.

## Rollback Plan

Per unit, reverse dependency order. Every unit is additive UI: reverting 5, 6 or
7 removes a bulk action and leaves the selection column inert but harmless;
reverting 4 removes selection entirely; reverting 3 or 2 restores the inline
links; reverting 1 restores the bare table. No migration, no schema change, no
data written that a revert would strand. The tracker branch stays draft until
every child lands, so `main` never holds a bulk action whose per-row safety loop
has not shipped.

The one asymmetric case: a bulk action already executed cannot be rolled back by
reverting code — deactivations are soft (`deactivated_at`) and reversible by
hand; a bulk status change to `done` or `cancelled` is **terminal** under
`ALLOWED_TRANSITIONS` and cannot be undone through the UI at all. Say so in the
confirmation copy.

## Dependencies

- **PRs #83–#86 (`table-column-sorting`) merged.** Hard blocker.
- No new packages: `checkbox.tsx` and `dropdown-menu.tsx` already exist.
- A dev database with real volume (368 customers, ~700 inventory pages) to
  exercise cross-page selection. AGENTS.md's precedent stands: a bug that
  depends on data volume does not exist until there is data.

## Open Questions

1. **Bulk transport: client-side sequential loop over the existing per-row
   routes, or new bulk endpoints?** The loop is zero new server code and already
   the shape used today (`UsersTable.tsx:122-150`); bulk endpoints buy back
   progress/cancellation at the cost of four new routes. Either way the per-row
   service call is mandatory. `sdd-design` decides.
2. **Filter-vs-selection: keep, drop, or warn?** Named here as an obligation;
   the choice itself belongs to `sdd-spec`.
3. **`Card` or `Table` owns the container?** One of them has to give up its
   border.
4. **Users mixed selection**: two eligibility-scoped actions, or one action with
   per-row refusals?
5. **Does the selection survive a page reload / soft navigation away?** Client
   state says no. Probably correct — an invisible selection is worse than a lost
   one — but state it rather than inherit it from the implementation.

## Success Criteria

- [ ] The four tables render as one visual component; no double border anywhere,
      and the six other `table.tsx` consumers still look right, including the two
      inside dialogs
- [ ] Every kebab trigger measures at least 44x44; the two `h-7` links are gone
- [ ] Selecting rows on page 1 and page 3 keeps all of them; the bar states what
      is selected off-screen and offers a way to see or clear it
- [ ] Changing a filter with a live selection produces the specified keep/drop/warn
      behaviour, visibly, and a test asserts it
- [ ] Selecting both remaining administrators and hitting Desactivar deactivates
      exactly one and names the second with `last_active_admin` — asserted by a
      test, verified against a real database
- [ ] A mixed-status selection bulk-set to one status applies the legal rows and
      reports each illegal one by id and reason
- [ ] Sending an inventory selection to the generador opens the builder with
      exactly those products
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit
- [ ] Each unit that adds a client boundary or a portal was opened in a browser
      with the console read — a green suite is not evidence for either
