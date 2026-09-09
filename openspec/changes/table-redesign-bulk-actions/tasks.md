# Tasks: table-redesign-bulk-actions

## Ready to start — the block cleared 2026-09-08

PRs #83–#86 (`table-column-sorting`) are merged and archived; `main` is at
`d884d5b`. The four page files this change rewrites are no longer open in any
PR, so the conflict this section used to warn about cannot happen.

**Every `file:line` citation in this change was re-verified against `main`**,
not merely assumed to survive the merge. Two facts make that verification
meaningful rather than a formality:

- `src/` is **byte-identical** between `main` and the `preview/table-sorting-all`
  worktree these artifacts were written against — the merges that landed
  afterwards touched only `openspec/`. So the citations were valid by
  construction, and the check confirmed it rather than discovering it.
- All 49 citations resolve and fall inside their files. The twelve that the
  plan actually hangs on were checked for CONTENT, not just range — a line
  number that exists but points at the wrong code is the failure mode this
  repo has already shipped twice. All twelve matched exactly:
  `table.tsx:60,73,86` (the selection affordances that already exist),
  `dropdown-menu.tsx:34` (the portal), `transitions.ts:36,48`,
  `selection.ts:51` (`MAX_TOTAL_PRODUCTS`), `CatalogBuilderForm.tsx:439` (the
  self-wrapped border — the double-border risk unit 1 exists to avoid),
  `UsersTable.tsx:122,171`, and the two permission gates at
  `api/users/[id]/route.ts:37` and `api/customers/[id]/route.ts:36`.
- One citation was WRONG and is fixed: `proposal.md` said
  `transitions.ts:45` for `getAllowedTransitions`; the symbol is at `:48`.
  `design.md` had already caught it. Prefer the symbol name over the number
  when they disagree — line numbers rot, and a reader who follows a stale one
  lands on plausible unrelated code, which is worse than a dangling name.

Start with Phase 1.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2,080 |
| Review budget (this session) | 800 lines per PR |
| 800-line budget risk | High (total), Low per unit |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain (cached at session start) |
| Chain strategy | feature-branch-chain, matching `crm-shell-settings-rbac` and `crm-workshop-management` |

Decision needed before apply: No (auto-chain, cached at session start)

### Suggested Work Units — proposal's split, held after re-forecast

The proposal's 7-unit split is evaluated against design.md, not copied blind.
**It holds, with one change**: unit 7 takes its pre-declared 7a/7b split now
rather than deferring it, because the two halves already touch fully disjoint
files (inventory-side navigation vs. builder-side resolution) and 7b is the
change's only new-SQL surface — isolating it the same way unit 4/5 already
isolate the selection primitive from the destructive mutation is worth the
extra PR at this size, not just at the ~500-line trigger the proposal named.

The shared selection model (`useRowSelection`, `SelectionProvider`,
`SelectionBar`, `BulkResultPanel`, `run-sequential.ts`) is born in **unit 4**,
confirmed by design.md's own File Changes table (not re-derived here) — units
6, 7a hand-roll a wrapper around that shared model per D4; they do not
duplicate it.

| Unit | Goal | Est. lines | Depends on |
|---|---|---|---|
| 1 | `table.tsx` shell (header fill only, D7) + browser-verify all consumers except `UsersTable` | ~100 | tracker |
| 2 | Kebab on customers / inventory / service-orders — `RowActions`, 44×44 trigger, 1 customers test assertion | ~200 | 1 |
| 3 | Kebab on users + its Card wrap (deferred here from unit 1, per design's File Changes table) + Estado badge (D8) + the 12 concentrated test assertions | ~210 | 2 |
| 4 | Selection primitive on **customers only**: `run-sequential.ts`, `useRowSelection`, `SelectionProvider`/`Bar`/`RowCheckbox`/`BulkResultPanel`, the filter-clear rule | ~450 | 2 |
| 5 | Bulk activar/desactivar for customers + users, `refusals.ts`, per-row result panel, **the admin-floor safety test** | ~380 | 3, 4 |
| 6 | service-orders selection + bulk status via `getAllowedTransitions` intersection, `STATUS_LABEL` consolidation (D9) | ~320 | 4 |
| 7a | Inventory selection + handoff transport (URL of ids, 200-cap refusal) | ~170 | 4 |
| 7b | Builder accepts a product-id list (`listProductsByIds` — the only new SQL — route branch, second selection mode) | ~260 | 7a |

```
tracker (draft, no-merge)
  └── 1 shell ── 2 kebab ─┬─ 3 users kebab ─┐
                          └─ 4 selection ───┴─ 5 bulk activate
                                            ├─ 6 orders status
                                            └─ 7a inventory handoff ── 7b builder id-mode
```

Branch names follow the `crm-workshop/prN-*` convention:
`table-bulk/pr1-shell` → `pr2-kebab` → `pr3-users-kebab` / `pr4-selection` →
`pr5-bulk-activate` / `pr6-orders-status` / `pr7a-inventory-handoff` →
`pr7b-builder-id-mode`.

## Gates, every unit

- `npm test` and `npx tsc --noEmit` clean before opening that unit's PR.
- `gga run --pr-mode --diff-only` (see AGENTS.md — `GGA_TIMEOUT=900`, pin
  `PR_BASE_BRANCH` to the previous unit's branch since `--pr-mode` auto-detect
  resolves to `main` on a chained branch).
- `gentle-ai review status --contract gentle-ai.review-integration/v2 --agent
  <runtime> --next-transition` before delivery.
- Every unit that adds a client boundary or a portal (2, 3, 4, 5, 6, 7a) gets a
  **browser check with the console open** — jsdom cannot see either failure
  mode (AGENTS.md's second documented limit). This is not optional and a green
  suite is not evidence for it.
- Every mutation task in this file ends with a `diff` proving the change
  actually landed in the file before trusting the test result. `sd` exits 0
  when it matches nothing, and this repo has twice nearly recorded a placebo
  as verified.

---

## Phase 1 — `table.tsx` shell (table-bulk-actions: *Shaded Table Header, Container Unchanged*; design D7)

- [x] 1.1 Add the shaded-header class to `TableHeader` in `src/components/ui/table.tsx` (today `[&_tr]:border-b` only). Do **not** add a border or rounded class to `Table` itself — the four list pages' existing `Card`/`CardContent` stays the sole container (double-border risk named in the proposal).

  **GGA found a second-order effect full opacity created, and it was real.**
  `Table` renders its own square-clipping `overflow-x-auto` div, but four
  consumers hand-roll their own wrapper — and two of those (`CatalogBuilderForm`
  and `ServiceOrderForm`'s cart table) had `rounded-lg` with NO `overflow`, so
  they never clipped. Transparent, that was invisible; opaque, the band paints
  into the 8px corner arcs. Both got `overflow-hidden`. Note the irony worth
  keeping: task 1.3 named `CatalogBuilderForm` as the sharpest risk and named
  the WRONG symptom — double border, which never happened.

  **Also corrected: "five consumers" was a number nobody counted.** There are
  14 `<Table>` uses across 13 files; every one but `UsersTable` already brings
  its own container. The comment now says that instead of a figure repeated
  from the design doc without checking.

  Shipped as `bg-muted` at FULL opacity, not `bg-muted/50`. The /50 variant was
  tried first and measured invisible: light `--muted` is `hsl(240 4.8% 95.9%)`,
  so at half alpha the header computed to `oklab(0.967 …/0.5)` against a white
  card — the browser check showed no perceptible band, which is not "shaded".
  Full opacity gives `rgb(244 244 245)` in light and a clearly lighter band in
  dark. `TableFooter` and the row hover state keep their own `/50`; only the
  header is opaque.
- [x] 1.2 `diff` the file — confirm only `TableHeader`'s `className` changed and no other export in the file moved.
- [x] 1.3 **Browser check, both themes, 0 console errors — the only verification unit 1 has** (no test asserts table chrome, per design's Verification Notes): open every non-`UsersTable` consumer and confirm exactly one bordered container, shaded header, no visual regression:
  - `/customers`, `/inventory`, `/service-orders` list pages
  - `/customers/[id]` vehicles sub-table, `/service-orders/[id]` sub-table, `/vehicles/[vehicleId]`
  - `CatalogBuilderForm.tsx:439` (already wraps `rounded-lg border` — confirm no double border specifically here, the case the proposal names as the sharpest risk)
  - `CustomerPicker` (inside a dialog)
  - the 3 `loading.tsx` skeletons (customers, inventory, service-orders)

  Re-earned after the GGA fixes, measured in the live DOM rather than judged
  from a screenshot (8px arcs do not survive a screenshot at page zoom):
  `/customers`, `/inventory`, `/users`, both themes, console clean, and the
  catalog builder's review table confirmed `overflow: hidden` + `8px` radius
  with exactly ONE bordered ancestor.

  **One gap, stated rather than ticked over:** `ServiceOrderForm`'s cart table
  is gated on `cart.length > 0`, which needs a customer, a vehicle and a part
  added inside the new-order dialog. Its wrapper carries the identical
  `overflow-hidden` class and its sibling search table was verified live in
  that same dialog — but the cart table itself was never rendered. If anything
  in this unit is wrong, that is where it is.
- [x] 1.4 Also open `/users` and confirm the bare `<Table>` (not yet Card-wrapped — that lands in unit 3 per design's File Changes table) shows the shaded header with no broken layout in the interim. Do not add a Card here; that is unit 3's job, bundled with the file's next real touch.
- [x] 1.5 `npm test` and `npx tsc --noEmit` clean.

## Phase 2 — Kebab on customers / inventory / service-orders (table-bulk-actions: *Kebab Row-Action Menu at 44x44*; design D6)

- [x] 2.1 Create `src/shared/ui/selection/RowActions.tsx` — trigger `min-h-11 min-w-11` + `dropdown-menu.tsx` portal content; items are declared by the calling page (no shared action registry, per design). Copy the `buttonVariants`-on-a-plain-element idiom from `customers/page.tsx`'s existing 44×44 link, not `<Button render={<Link/>}>` — that file's own comment documents why (base-ui logs a console warning and drops the anchor out of the links list otherwise).
- [x] 2.2 RED (jsdom) — update `customers/page.test.tsx`'s existing "the row action stays a link" assertion (`getByRole("link", {name:"Ver"})`) to target the new kebab shape; confirm it fails against the **old** direct-link markup before touching the component.
- [x] 2.3 GREEN — replace the inline "Ver" link with `RowActions` in `customers/page.tsx`, `inventory/page.tsx` (currently `h-7`, the 28px violation of AGENTS.md's 44×44 rule), and `service-orders/page.tsx` (also `h-7`). Both `h-7` links are **deleted, not restyled** (spec Scenario "Trigger meets the hit-target floor").
- [x] 2.4 `diff` each of the three page files plus `RowActions.tsx` before trusting 2.2's result.
- [x] 2.5 **Browser check, both themes, 0 console errors**: kebab trigger measures ≥44×44 on all three pages (devtools box model — AGENTS.md: no test asserts a button height), portal-backed menu opens with no hydration warning (new client boundary + portal, first of the change's four).

  **GGA found a keyboard regression and it reproduced.** The first version
  nested the link inside the item (`<DropdownMenuItem><Link/></DropdownMenuItem>`).
  Measured independently against base-ui 1.6 with `user-event`: ArrowDown+Enter
  fires base-ui's click on the `role="menuitem"` DIV and it never reaches the
  anchor — **0 activations**. With `render={<Link/>}` the anchor IS the
  menuitem and the same keystrokes activate it — **1**. "Ver" was reachable by
  Tab+Enter as a bare link before the kebab, so nesting it silently removed the
  keyboard path from three tables. Switched to `render`, mutation-verified in
  both directions.

  This does NOT contradict `customers/page.tsx`'s older `buttonVariants`
  comment: that one rejects base-ui's `Button` COMPONENT wrapping an anchor.
  `DropdownMenuItem`'s `render` is the library's ordinary composition API.

  **The test shipped in the first pass was pinning the broken shape.** It
  asserted `getByRole("link", {name:"Ver"})`, which only the nested form
  produces — so it forbade the fix rather than catching the bug. Replaced with
  an ACTIVATION assertion plus an href assertion.

  Measured in the live DOM: trigger is exactly 44x44 on `/customers` and
  `/inventory`, one per row, `aria-label` in Spanish, no bare link left in the
  cell, menu renders outside the `<table>` (real portal) and its item is a real
  `<a href>`. Console carried 48 messages and **zero** were errors or hydration
  warnings — all HMR/Fast Refresh. `/service-orders` has 0 rows in the dev
  database, so its kebab was verified by code and by the shared component,
  never rendered with data.

  **A second honest gap: end-to-end keyboard was NOT verified in a real
  browser.** The Chrome extension's synthetic keystrokes do not reach the page
  — a control test typed "abc" into a focused input and the value stayed empty
  — so every browser keyboard attempt here proves nothing in either direction.
  The evidence for the fix is the jsdom/`user-event` measurement above plus the
  live DOM now showing `<a role="menuitem" href>`, the shape that activates.

  **DECIDED 2026-09-08 — the one-item kebab stays.** The owner picked the
  reference-faithful option twice, the spec says MUST, and it is implemented
  and reviewed. Reversing it now would be a third change of direction on the
  same question. This is settled; do not reopen it per unit.

  **UX cost, recorded because it is permanent and not scaffolding:** on these
  three pages the kebab holds exactly ONE item forever. Phase 3.4 is the only
  place a second row action appears, and it is `/users`; phases 5, 6 and 7a
  wire their actions into `SelectionBar`, not into `RowActions`. So "Ver" goes
  from one click to two on the three highest-traffic tables, permanently, and
  costs a portal per row. The spec mandates it (`MUST replace its inline
  row-action link(s) with a single kebab-trigger button per row`) and it is
  implemented as written — but reversing it later is a spec edit, not a code
  edit, so the owner should see it now.
- [x] 2.6 `npm test` and `npx tsc --noEmit` clean.

## Phase 3 — Kebab on users, its Card wrap, and its Estado badge (table-bulk-actions: *Kebab...* Scenario "Existing actions unchanged", *Enum Column Badges*; design D7, D8)

- [x] 3.1 Wrap `UsersTable.tsx`'s `<Table>` in `<Card size="sm"><CardContent>` around the table only — the `Mostrar inactivos` toggle and the `role="alert"` error stay above it, matching the other three pages' pattern (D7; this file change is assigned here, not unit 1, per design's File Changes table).
- [x] 3.2 Replace the bare "Activo"/"Inactivo" text in the Estado column with `components/ui/badge.tsx` (D8). `StatusBadge` and customers' inline "Desactivado" pill are unaffected — this is the *only* new badge in the change.
- [x] 3.3 RED — update the 12 concentrated button-name assertions in `UsersTable.test.tsx` (they query `UserFormTrigger` + the Desactivar/Reactivar `Button` directly today); confirm they fail against the **old** markup once the kebab relocates those controls, for the right reason (not reachable by the old direct queries), before touching the component.
- [x] 3.4 GREEN — replace the two direct row actions with `RowActions` (unit 2): Editar (only when active) + Activar/Desactivar. Behavior identical to today, only relocated (spec Scenario "Existing actions unchanged").
- [x] 3.5 `diff` `UsersTable.tsx` and `UsersTable.test.tsx` before trusting 3.3/3.4.
- [x] 3.6 **Browser check, both themes, 0 console errors**: `/users` Card border, Estado badge renders, kebab ≥44×44, portal opens cleanly.

  Verified live: Card wraps the table, "Activo" renders as a `data-slot="badge"`,
  trigger measures exactly 44x44, menu holds Editar + Desactivar, and the edit
  dialog opens from the kebab prefilled with no dropdown painted behind it.

  **The keyboard rule INVERTS between unit 2 and this one, and it is measured,
  not reasoned.** Unit 2's item is a NAVIGATION and needs `render={<Link/>}`
  (nested = 0 activations). These two items are ACTIONS and need a plain
  `<DropdownMenuItem onClick>` — `render={<button/>}` swaps out base-ui's own
  item handler, which is what Enter reaches, giving 0 activations. Both
  directions are pinned by mutation, and the orchestrator re-ran the `render`
  mutation independently: `ArrowDown then Enter activates Editar` goes red.

  One divergence between jsdom and the real browser, worth recording rather
  than smoothing over: in jsdom, a dialog opened from inside an OPEN menu had
  its keystrokes eaten by base-ui's typeahead (React routes synthetic events
  along the React tree, so portalling does not escape it). That is why the
  dialog is hoisted out of `RowActions` and `UserForm` gained a controlled
  `open` prop. In the real browser the keydown was NOT prevented — so the
  hoist may be belt-and-braces there. It is kept: the jsdom failure is real
  for the test suite either way, and the hoisted shape is simpler to reason
  about than one that depends on which event system wins.
- [x] 3.7 `npm test` and `npx tsc --noEmit` clean.

## Phase 4 — Selection primitive, customers only (table-bulk-actions: *Cross-Page Checkbox Selection*, *Filter Change Clears the Selection*; design D2, D3, D4, D5)

- [x] 4.1 RED (node, DB-free) `src/shared/bulk/run-sequential.test.ts` — one call in flight at a time, `abort` stops before the next row, outcomes preserve input order (Interfaces block). Confirm RED with no implementation present.
- [x] 4.2 GREEN `src/shared/bulk/run-sequential.ts` — `runSequential(ids, apply, signal)`, exact signature from design's Interfaces block.
- [x] 4.3 **Mutation-verify the runner's single-flight guarantee, D2's binding requirement**: temporarily swap `run-sequential.ts`'s body for a `Promise.all`-based implementation and confirm the 4.1 test goes RED **by name** — not merely "some test fails". `diff` the file to confirm the swap actually landed, then revert and confirm GREEN again. This is layer one of D2's two-layer defense; layer two is unit 5's call-site test (5.6/5.7).
- [x] 4.4 RED (node) — `useRowSelection`: selection persists across a `pageIds` change (paging), a `filterKey` change triggers the injected `Reconcile` (default `dropAll`) and reports `clearedByFilter`, select-all-on-page toggles correctly.
- [x] 4.5 GREEN `src/shared/ui/selection/useRowSelection.ts` per the Interfaces block.
- [x] 4.6 Create `src/shared/ui/selection/SelectionProvider.tsx` — the thin `"use client"` wrapper receiving **only** `pageIds: string[]`, `labels: Record<string,string>`, `filterKey: string` from the server page (D3). No function and no `Date` crosses this boundary — every id/href/label/status stays a string, the exact rule the RSC-boundary defect already shipped once over.
- [x] 4.7 Create `src/shared/ui/selection/SelectionBar.tsx` — total count, off-screen affordance (spec Scenario "Off-screen selection is legible, not just counted" — "12 seleccionados" with 3 visible must say 9 are off-screen, not just print the number), "Limpiar selección", an action slot units 5/6/7a fill in.
- [x] 4.8 Create `src/shared/ui/selection/RowCheckbox.tsx` — reads the selection context, renders `components/ui/checkbox.tsx` (already exists; `table.tsx`'s `data-[state=selected]:bg-muted` on `TableRow` and `[&:has([role=checkbox])]:pr-0` on `TableHead`/`TableCell` already exist too — **no new table primitive needed**).
- [x] 4.9 Create `src/shared/ui/selection/BulkResultPanel.tsx` — the per-row ok/failed list shell; each capability's refusal-code → Spanish map is injected, not owned here (D4).
- [x] 4.10 RED (jsdom, `customers/page.test.tsx` idiom) — a filter change (search term or status) clears the selection and shows exactly `"Se limpió la selección de N al cambiar el filtro"` — **assert the Spanish string, never loosened**; sorting a column or turning the page does **not** clear it (spec Scenario "Sort and pagination do not clear it" — `filterKey` must exclude both).
- [x] 4.11 GREEN — wire `SelectionProvider`/`RowCheckbox`/`SelectionBar`/`BulkResultPanel` into `customers/page.tsx` only. `filterKey` is a server-computed canonical string built from `searchParams` (search + status), never from sort or page.
- [x] 4.12 `diff` `customers/page.tsx` and every new file under `src/shared/bulk/` and `src/shared/ui/selection/` before trusting 4.10/4.11.
- [x] 4.13 **Browser check, real data volume (368 customers, several pages), both themes, 0 console errors** — new client boundary, invisible to jsdom: tick rows on page 1 and page 3, confirm the bar reflects both counts and returning to page 1 shows those rows still checked; edit the search box and confirm the Spanish clear-message and empty selection.
- [x] 4.14 `npm test` and `npx tsc --noEmit` clean.

## Phase 5 — Bulk activar/desactivar, customers + users (customer-management, user-management deltas; design D1, D2)

- [x] 5.1 Wire customers' Activar/Desactivar buttons into `SelectionBar`'s action slot, calling `runSequential` over `PATCH /api/customers/[id]` with `{active}` — one request per id, awaited in order. No batched read, no `UPDATE ... WHERE id IN (...)`.
- [x] 5.2 Create `src/modules/account/refusals.ts` — `REFUSAL_MESSAGES` promoted verbatim out of `UsersTable.tsx` (`last_active_admin`/`self_deactivate`/`self_role_change`/`not_found`), shared by the row action and the new bulk panel.
- [x] 5.3 Wire `UsersTable.tsx`'s two new buttons — "Activar" and "Desactivar" as **separate, always-available actions** (never one action inferring direction per row — user-management spec) — calling `runSequential` over `PATCH /api/users/[id]`.
- [x] 5.4 RED/GREEN (customers) — a selection with already-deactivated rows reports them as a silent success, not a failure; a selection with a since-deleted id reports it by id with a "no longer exists" reason without failing the rest of the batch (customer-management spec Scenarios).
- [x] 5.5 **RED — the binding safety property (user-management spec, the admin-floor invariant, the single thing most likely to be got wrong in this change).** A behavioural test at the users bulk call site, injected `fetch`: given exactly 2 active administrators, selecting both and running "Desactivar" MUST issue exactly one successful PATCH, refuse the second with `last_active_admin`, and leave ≥1 administrator active. **Assert on call order and count against the injected `fetch`**, not only on the panel's final rendered content.
- [x] 5.6 **Mutation-verify 5.5 at the call site — this is the required check, not the generic mutation-verify pattern.** Temporarily bypass `runSequential` at the users bulk call site and issue the per-row `fetch` calls via `Promise.all` instead. Confirm the 5.5 test goes RED **by name**, and confirm it goes red *because* both admins are now evaluated concurrently against the same not-yet-decremented count (a race), not for an unrelated reason. **A test that only fails against a hypothetical batched `UPDATE ... WHERE id IN (...)` does not prove this property** — it must specifically catch the `Promise.all` substitution at this call site. `diff` the file to confirm the swap landed, then revert and confirm GREEN.
- [x] 5.7 RED/GREEN — self-inclusion: a selection containing the acting administrator's own account among others processes the others normally and refuses the actor's own row with `self_deactivate` (user-management spec Scenario).
- [x] 5.8 RED/GREEN — mixed active/inactive selection: "Desactivar" affects only the active rows; already-inactive rows report as a no-op, not a failure (user-management spec Scenario).
- [x] 5.9 `diff` every file touched in this unit before trusting 5.4–5.8.
- [x] 5.10 **Real-database smoke test — one of the two this change needs, per AGENTS.md's injected-seam limit.** `deactivateUser()`'s transaction is exercised only through an injected `database`/`listActiveAdminIds` seam in unit tests, so a green `npm test` here proves **zero** coverage of the real transaction's row-locking behavior. Stand up a throwaway database. **Correction, verified 2026-09-08: Docker is NOT broken** — that note was true on 2026-09-01 and has since resolved. `docker info` responds and the container `proyectocatalogo-db-1` (`postgres:17-alpine`) on `:5433` IS the app's own database, the same one `scripts/dev.sh` manages. Create a throwaway DATABASE on that server rather than a second server, and never point the test at `dforce_catalog` itself. Seed exactly 2 active administrators, run the bulk deactivate through the real route end-to-end, and confirm exactly one succeeds and the app is left with ≥1 active admin. Do **not** run this as part of `npm test`.

  **DONE, and it proved more than the task asked.** A throwaway
  `dforce_wu5_race` database on `:5433`, schema pushed, seeded with exactly two
  active administrators, calling the REAL `deactivateUser` — no injected seam,
  no fake. Run 40 times each way:

  ```
  CONCURRENTE x40: runs that left ZERO administrators = 40
  SECUENCIAL  x40: runs that left ZERO administrators = 0
  ```

  So the race is not theoretical and not an artifact of the test double: on
  real Postgres, with real transactions and the correct per-row service call,
  concurrency zeroes the admin floor **every single time** and sequencing never
  does. This is the strongest evidence in the change that `runSequential` is
  load-bearing rather than stylistic.

  One detail worth keeping: the FIRST single run did NOT reproduce it — the
  concurrent pair serialised on a cold connection pool. The race hides when
  connections are cold and is deterministic once they are warm, which is
  production. A one-shot check here would have concluded the opposite.

  Database dropped afterwards; the dev database's 370 customers were untouched.

  **What this test could NOT do, and why.** It calls the service directly with
  an actor OUTSIDE the admin set. Through the real route that is unreachable —
  see the discovery recorded under 5.5.
- [x] 5.11 **Browser check, both themes, 0 console errors**: `/customers` and `/users` bulk bars; the result panel names every failing row by label with its specific Spanish reason ("2 no se pudieron" with no names is explicitly not acceptable per spec).

  `/users` verified live: the bar renders "1 seleccionado", "Ver seleccionados",
  and **Activar / Desactivar as two separate always-available buttons**, all
  three at 44px height. The destructive path was NOT exercised — the dev
  database has exactly one administrator and running it would lock the owner
  out of the application. The behaviour it would exercise is covered by 5.5's
  call-site test and by 5.10's real-database run.
- [x] 5.12 `npm test` and `npx tsc --noEmit` clean.

## Phase 6 — service-orders selection + bulk status (service-orders delta; design D9)

- [ ] 6.1 Move `STATUS_LABEL` (currently duplicated at `service-orders/page.tsx` and `OrderStatusControls.tsx`) into `transitions.ts`, deleting both duplicates — a net deletion, in the file that already owns the state machine (D9). Both call sites already import from `transitions.ts`.
- [ ] 6.2 RED (node, beside `transitions.test.ts`) — a pure intersection helper over `getAllowedTransitions` across a mixed-status selection (e.g. 3 `open` + 1 `in_progress` → only `cancelled`); empty-intersection case.
- [ ] 6.3 GREEN — implement the intersection helper.
- [ ] 6.4 Wire a hand-rolled selection wrapper (consuming unit 4's `useRowSelection`/`SelectionBar`/`BulkResultPanel`, per D4 — no shared page wrapper) into `service-orders/page.tsx`. The bulk status menu offers **only** the 6.3 intersection, never every status unconditionally (spec Scenario "Menu offers only the legal intersection").
- [ ] 6.5 GREEN — the bulk action calls `runSequential` over `PATCH /api/service-orders/[id]` with `{status}`, evaluated per row against that row's **current** status.
- [ ] 6.6 RED/GREEN — concurrent status drift: one row transitions away under another session before the bulk action runs; the bulk action still applies to the rows still legal and reports the drifted one by id with the reason its current status no longer allows the transition (spec Scenario).
- [ ] 6.7 RED/GREEN — confirmation copy for a bulk move to `done`/`cancelled` states the change is terminal and cannot be undone through the UI (spec Scenario "Terminal-status warning shown before applying").
- [ ] 6.8 `diff` every touched file before trusting 6.2–6.7.
- [ ] 6.9 **Browser check, both themes, 0 console errors**: the bulk status menu computes the intersection client-side with no round trip (D9), new client boundary + portal check.
- [ ] 6.10 `npm test` and `npx tsc --noEmit` clean.

## Phase 7a — Inventory selection + handoff transport (catalog-generation delta, transport half; design D10)

- [ ] 7a.1 Wire a hand-rolled selection wrapper into `inventory/page.tsx` (consuming unit 4's shared model). No `BulkResultPanel` here — this is a navigation, not a per-row mutation.
- [ ] 7a.2 RED — the selection bar refuses navigating with a selection larger than `MAX_TOTAL_PRODUCTS` (200, `catalog-builder/selection.ts:51`), in Spanish, **before** navigating (D10 point 4).
- [ ] 7a.3 GREEN — build the `?products=id1,id2,...` URL for client navigation and the ≤200 refusal copy.
- [ ] 7a.4 `diff` `inventory/page.tsx` and any new wrapper file before trusting 7a.2/7a.3.
- [ ] 7a.5 **Browser check, both themes, 0 console errors**: `/inventory` selection bar, the >200 refusal message, no regression to the kebab from unit 2.
- [ ] 7a.6 `npm test` and `npx tsc --noEmit` clean.

## Phase 7b — Builder accepts a product-id list (catalog-generation delta, resolution half; design D10)

- [ ] 7b.1 `src/app/(app)/builder/page.tsx` — parse `?products=` into `seedProductIds: string[]`, capped at 200 server-side too (defense in depth beyond 7a's client-side cap, in case the URL is hand-edited).
- [ ] 7b.2 `POST /api/catalog-builder/products` — add a `productIds` branch beside the existing `categories`-only body. Same `catalogs.read` gate, no new `ROUTE_GUARDS` entry needed (this route already has one — confirm `route-guards.test.ts`'s cross-reference check still passes with the new branch).
- [ ] 7b.3 RED (node) `catalog-builder/queries.test.ts` — `listProductsByIds(ids)` returns the **same projection** as `listProductsInCategories` (`image`, `imageType`, the two-guard `priceLists` aggregate) for a given id set, over an injected query function.
- [ ] 7b.4 GREEN `listProductsByIds` — **this is the change's only new SQL.** Reuse the projection verbatim; a thinner one silently degrades the review step and the printed prices (D10 point 2).
- [ ] 7b.5 RED/GREEN — a stale id (removed from inventory since the handoff) is dropped, not fabricated; the builder proceeds with the remaining valid products (catalog-generation spec Scenario).
- [ ] 7b.6 `CatalogBuilderForm.tsx` — second selection mode: when `seedProductIds` is present, `candidates` come from the id lookup and `selectedCategories` stays empty. `deriveCatalogTitle(uniqueL1s(...))` falls back to the distinct L1s carried on the returned rows rather than an empty category-ref list (D10 point 3).
- [ ] 7b.7 RED/GREEN — the existing category-tree flow is unaffected by the new mode (catalog-generation spec Scenario "Category-tree mode is unaffected").
- [ ] 7b.8 `diff` every touched file before trusting 7b.3–7b.7.
- [ ] 7b.9 **Real-database smoke test — the second and last one this change needs.** `listProductsByIds` against a real throwaway Postgres, confirming its projection matches `listProductsInCategories`'s exactly and that an oversized id list is refused server-side too.
- [ ] 7b.10 **Browser check, both themes, 0 console errors**: `/inventory` → send to builder → `/builder` opens pre-populated with exactly the selected products in product-id mode, category tree empty, title falls back correctly.
- [ ] 7b.11 `npm test` and `npx tsc --noEmit` clean.

---

## Follow-ups — named, deliberately not folded into this change

- **Server-side "select all N matching the filter"** (table-bulk-actions / catalog-generation). Without it, building a catalog from a selection larger than one inventory page means ticking rows across up to ~70 pages. Proposal's "Known limitation, accepted" — its own change.
- **`/inventory` page copy is English** ("Inventory", "No products found", "Clear filters", "Category L1", "Category L2") against AGENTS.md's Spanish-UI convention. This change adds a Spanish selection bar and kebab to that page, shipping a half-translated screen — not this change's job to fix; translate the page in its own change.
- **Cross-operator admin race** (two humans, two browsers, interleaved `deactivateUser` transactions) — pre-existing, not introduced by this change, and stays open after it. Its real fix is `SELECT … FOR UPDATE` inside `deactivateUser`'s transaction: new SQL, in the injected-seam blind spot, needs its own throwaway-Postgres verification, and is its own change.
- **`StatusBadge` → `components/ui/badge.tsx` migration** (8 call sites). Out of scope per the proposal's "What Does NOT Change" — wider blast radius than this whole change.

## Closing checklist (maps to proposal.md's Success Criteria)

- [ ] Four tables read as one visual component; no double border anywhere, including the two `table.tsx` consumers inside dialogs (Phase 1)
- [ ] Every kebab trigger measures ≥44×44; both `h-7` links are gone (Phases 2–3)
- [ ] Selection survives paging across pages 1 and 3; the bar states the off-screen count and offers a way to see/clear it (Phase 4)
- [ ] A filter change with a live selection clears it, visibly, in the exact Spanish string, and a test asserts it (Phase 4)
- [ ] Selecting both remaining administrators and hitting Desactivar deactivates exactly one and names the second with `last_active_admin` — asserted by a test AND verified against a real database (Phase 5)
- [ ] A mixed-status bulk transition applies the legal rows and reports each illegal one by id and reason (Phase 6)
- [ ] Sending an inventory selection to the generador opens the builder with exactly those products (Phases 7a–7b)
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit
- [ ] Every unit that adds a client boundary or a portal was opened in a browser with the console read
