# Design: table-redesign-bulk-actions

## Technical Approach

Four seams, all already in the repo, plus exactly one genuinely new integration.

1. **The shell** is one class on `TableHeader` (`table.tsx`). `Card` keeps the border — D7.
2. **The kebab** is one client `RowActions` per table, composed by that table's own client
   wrapper. No shared action registry.
3. **The selection** is client state in one shared hook, wrapped per page by a thin
   `"use client"` component that receives **only strings** across the RSC boundary — D3.
4. **The mutation** is a sequential client loop over the per-row API routes that already
   exist. Zero new routes, zero new SQL, zero new permission surface — D1/D2.
5. **The one new thing** is the inventory → builder handoff: a URL of product ids, a
   `productIds` branch on the existing products route, and a by-ids query. That query is the
   only new SQL in the change, and therefore the only thing needing a real database — D10.

The post-sorting shape (`preview/table-sorting-all`) is the baseline: the three server pages
already declare a local `COLUMNS` literal, a `SortableHeader`, and `buildSortHref`/
`buildPageHrefPattern`; `UsersTable` is already `"use client"` with `useState` sort. Nothing
in this change re-opens those.

---

## D1 — The bulk transport is a sequential client-side loop over the existing per-row routes. No bulk endpoint.

**This corrects the proposal's open question 1, and the premise under it.** The proposal says
`UsersTable.toggleActive` "already loops HTTP one row at a time". It does not: `toggleActive`
(`UsersTable.tsx:122-150`) handles exactly **one** row and returns. There is no loop anywhere
today, so both options are new code and the comparison has to be made on merit.

| Option | Buys | Costs |
|---|---|---|
| **Client sequential loop** over `PATCH /api/{customers,users,service-orders}/[id]` | zero new server code; per-row reasons and partial success fall out of per-row responses; every row's precondition is re-read inside its own request | N round trips; no server-side cancellation; the tab owns the loop |
| New bulk endpoint per capability | one round trip; server-side progress/cancellation | 3 new routes, 3 new `ROUTE_GUARDS` entries, a new permission surface, and a server-side loop that is exactly the thing a later reader rewrites as `UPDATE … WHERE id IN (…)` |

**Chosen: the client loop.** AGENTS.md's *Simplicity & scope discipline* asks first whether a
module already does this. `PATCH /api/users/[id]` already routes `{active:false}` to
`deactivateUser()` (`route.ts:64-68`) and already returns the machine refusal reason with a 400
(`route.ts:72-75`); `PATCH /api/customers/[id]` already routes `{active}` to
`deactivateCliente`/`reactivateCliente` and already rejects `active` combined with field edits
(`route.ts:93-98`); `PATCH /api/service-orders/[id]` already routes `{status}` through
`transitionOrder` → `assertTransition` and already answers
`{error:"invalid_transition", from, to}` (`route.ts:36-38, 93-95`). Bulk is a **caller**, not a
new capability.

The N-round-trip cost is real and accepted: a 40-row selection is 40 sequential PATCHes.
Cancellation is bought back on the client — the runner checks an abort flag between rows, so
"Cancelar" stops before the next request rather than after the last one. What is *not* bought
back: closing the tab mid-loop stops the batch and takes the result panel with it. Stated, not
designed around; every applied row is independently durable and re-running the remainder is
safe.

**Rejected — parallel `Promise.all` over the same routes.** See D2: parallelism is the bug.

## D2 — Sequencing is a safety invariant, not a politeness. Here is what stops a future edit from breaking it.

`deactivateUser()` (`account/service.ts:454-479`) is race-safe only because it re-queries
`activeAdminIds` **inside its own transaction, per call**, before `checkAdminSafety`
(`service.ts:249-267`). Two consequences that must both hold:

- **No batched precondition read.** Any bulk path that reads the active-admin list once and
  loops evaluates every row against the stale pre-batch list; a selection containing every
  admin passes every check and leaves zero administrators.
- **No concurrency either.** Per-call transactions are *not* enough under READ COMMITTED: two
  overlapping `deactivateUser` transactions both observe two active admins and both proceed.
  `Promise.all` over the per-row route re-introduces the exact failure the transaction was
  written to prevent. **Sequential is load-bearing.**

Four things enforce this, in descending order of how hard they are to defeat:

1. **There is no bulk route to write bulk SQL in.** `route-guards.test.ts` enumerates
   `src/app/api/**/route.ts` from the filesystem and fails when a route has no `ROUTE_GUARDS`
   entry (`route-guards.test.ts:95-146`), and a second suite cross-references the declared
   action against the route source (`:226`). Adding a bulk endpoint therefore turns `npm test`
   red until someone writes it down. It cannot be a quiet optimisation.
2. **One runner, `src/shared/bulk/run-sequential.ts`** — pure, DB-free, `await`s each result
   before issuing the next, checks `signal.aborted` between rows. It is the only way a bulk
   action executes.
3. **A RED test asserting single-flight**: the runner is handed a `fn` that records overlap and
   never resolves until told; the test asserts a second invocation never begins while the first
   is pending. Mutation-verify it by swapping the body for `Promise.all` — the test must go red
   **by name**.
4. **A behavioural test at the users call site**: both remaining admins selected → exactly one
   deactivation is issued and applied, the second returns `last_active_admin`, and the result
   panel names that row. Also run against a throwaway Postgres (see Testing).

**Residual, named rather than fixed**: two operators in two browsers can still interleave. That
race exists on `main` today, is not introduced here, and its real fix is `SELECT … FOR UPDATE`
inside `deactivateUser`'s transaction — new SQL, in the injected-seam blind spot, and its own
change. It goes in `tasks.md` as a follow-up.

Same class, same shape, for service orders: `assertTransition(from, to)` (`transitions.ts:36`)
reads each row's **current** status, so `open` + `done` both set to `in_progress` is one legal
write and one `OrderTransitionError`. Per-row loop, per-row reason. See D9.

## D3 — Where the client boundary goes, and exactly what crosses it

`/customers`, `/inventory`, `/service-orders` stay Server Components. The table rows keep being
rendered on the server; a thin client wrapper provides selection context around them.

```
page.tsx (server)
  <SelectionProvider pageIds={string[]} labels={Record<string,string>} filterKey={string}>
    <SelectionBar … />                  ← client
    <Table>…server-rendered rows…       ← RSC children, passed through
        <RowCheckbox id={string} />     ← client, reads context
        <RowActions id viewHref … />    ← client
    </Table>
    <BulkResultPanel />                 ← client
  </SelectionProvider>
```

**The complete list of what crosses each boundary** — every entry is a primitive, an array of
primitives, or a `Record<string,string>`, and there is not one function among them:

| Prop | Type | Why it is serializable |
|---|---|---|
| `pageIds` | `string[]` | ids of the rows on this page, for select-all-on-page and the header tri-state |
| `labels` | `Record<string,string>` | id → display name, captured server-side for the rows on screen (see D5) |
| `filterKey` | `string` | canonical serialisation of the active filters, built from `searchParams` |
| `id`, `viewHref`, `status`, `label` | `string` | per row |
| server-rendered rows | JSX children | already-rendered elements, not a render prop |

AGENTS.md's first documented production defect was a **function** handed from a Server
Component to a client one; `customers/page.tsx`'s `buildPageHrefPattern` comment records the
fix — a serializable `{page}` string, not a callback. This design inherits that rule verbatim:
**an href is a string pattern, an action is code the client wrapper already imports.** A `Date`
is a second trap of the same family — `UsersTable.UserRow.deactivatedAt` is already typed
`string | null` "serialised over the RSC boundary" (`UsersTable.tsx:21-23`), and any new row
prop follows it.

`/users` needs no wrapper: `UsersTable` is already `"use client"` and holds every row.

**Rejected — lifting the whole table into a client component per page.** It would move the
list rendering, the empty states and the sort links across the boundary for nothing, and
`/customers`' empty-state branches alone are 60 lines of server-side copy.

**Rejected — `typeof document !== "undefined"` guards anywhere.** AGENTS.md names that as
React's documented cause #1 for a hydration mismatch and it already shipped here once.

## D4 — Four hand-rolled wrappers, one shared selection model. Not one abstraction, not four copies.

`table-column-sorting` D3 chose duplication for `parse*Sort` and it held up, so the question is
what makes this different. The answer: there the duplicated thing was a **shape** (three
20-line parsers with the same signature). Here the duplicated thing would be a **safety rule** —
what happens to a live selection when the filter changes, and how an off-screen selection is
made legible. Copying that four times is four chances to get the sharpest edge in the change
wrong, and it defeats the whole reason unit 4 lands the selection primitive on one table first.

So the split is:

| Shared, written once | Hand-rolled per table |
|---|---|
| `useRowSelection` — the `Set<string>`, the label map, select-all-on-page, the filter-change rule | the client wrapper itself (what it wraps, what it passes) |
| `SelectionBar` — count, off-screen affordance, "Limpiar selección", action slot | the action buttons in that slot and the endpoint each calls |
| `BulkResultPanel` — per-row ok/failed list | that capability's refusal-code → Spanish map |
| `run-sequential.ts` — D2's runner | the per-row request body |

Four call sites is past the "extract when a fourth caller appears" threshold that same D3 set,
and one of the four (`/users`) differs enough — no pagination, no URL filters, client-side rows
— that it consumes the hook and none of the wrapper. Location follows the repo: pure logic in
`src/shared/bulk/`, shared UI in `src/shared/ui/selection/` beside `Pagination`.

**Rejected — a generic `<DataTable columns rows>`**, TanStack-style. Four call sites with four
different data sources and four different action sets is not enough evidence for a table
framework, and it would swallow the sort links and empty states that already work.

## D5 — A filter change clears the whole selection, announced in Spanish. The reconciler is a seam.

Selection persists across pages (decided). It therefore outlives every filter change, and the
spec is choosing between clearing everything and a server round trip that resolves survivors.
**Design for both, build clear-all.**

The seam is one injected function on the hook:

```ts
type Reconcile = (selected: ReadonlySet<string>, nextFilterKey: string) => Promise<string[]>;
const dropAll: Reconcile = async () => [];                 // what we build
// const resolveSurvivors: Reconcile = (ids, key) => post("/api/…/resolve", { ids, key });
```

`filterKey` is a server-computed string prop (D3); the hook reacts to it changing, calls
`Reconcile`, and reports `previous.size - survivors.length` to the bar.

**Why clear-all**: it needs no server code and no new permission surface, which keeps it
consistent with D1; "resolve survivors" needs a per-capability endpoint taking an id list plus
filters, which is the same shape D2 spent its budget keeping out of the codebase; and a
partially-surviving selection is the state that reads worst on screen — 12 becomes 7 with no
way to see which 5 left. After changing a filter the operator's working set genuinely is new.

**Cost, stated**: a selection assembled over three pages dies on a mistyped search. Mitigated
by making it loud, never silent — the bar prints, in Spanish, that the selection was cleared
and how many rows it held, and the "Ver seleccionados" panel exists so it can be checked before
touching a filter.

On `/users` the trigger is `Mostrar inactivos` (`UsersTable.tsx:110`), not a URL: same rule,
same copy, and its `filterKey` is just `String(showInactive)`. Users *could* compute exact
survivors locally for free — deliberately not done, so there is one rule and one sentence
across all four tables rather than a per-table dialect.

**Off-screen legibility** (proposal obligation, not a discovery): the hook keeps
`Map<id, label>` populated at tick time from the `labels` prop, so the panel can name rows that
are no longer rendered. A label captured on page 1 can go stale if the row is renamed
elsewhere; accepted — a stale name beside a live id is strictly better than a bare count.

## D6 — `RowActions` is a dumb kebab; the items are declared by the client wrapper

`dropdown-menu.tsx` wraps `@base-ui/react/menu` and portals. `RowActions` = trigger + content,
props are strings, items are declared in the per-page client wrapper (which already exists per
D3 and already has the handlers). Nothing from the server is a callback.

**The trigger is `min-h-11 min-w-11`.** AGENTS.md's 44x44 rule binds here and its waiver does
not apply: these are workshop tablets. `inventory/page.tsx:147` and
`service-orders/page.tsx:156` currently render `h-7` = 28px links; those two are deleted, not
restyled. `customers/page.tsx:279` already ships `min-h-11 min-w-11` and is the pattern to
copy — including `buttonVariants` on a plain element rather than `<Button render={<Link/>}>`,
for the reason that file's comment records.

## D7 — `Card` keeps the container; `TableHeader` gains only the shaded header

Decided; the evidence that it is the right way round: `CatalogBuilderForm.tsx:439` wraps its
table in its own `rounded-lg border border-border`, and the three list pages wrap theirs in
`<Card size="sm"><CardContent>`. A border on `Table` double-borders **five** of the ten
consumers, two of which sit inside a dialog. So `table.tsx`'s entire diff is a header fill on
`TableHeader` (which today only carries `[&_tr]:border-b`).

`UsersTable.tsx:171` renders a bare `<Table>` and gets `<Card size="sm"><CardContent>` around
**the table only** — the `Mostrar inactivos` toggle and the error `role="alert"` stay above it,
matching the other three pages where the filter strip is its own Card.

The three `loading.tsx` skeletons, `CustomerPicker`, and the three detail sub-tables inherit the
fill and are **looked at in unit 1**, not assumed. No test asserts table chrome, so unit 1's
verification is a browser and nothing else.

## D8 — One new badge: `/users` Estado. `StatusBadge` is not touched.

`BadgeStatus` is a closed union of 14 members over 8 consumers (`StatusBadge.tsx:3-19`);
adding `active`/`inactive` to it would widen a shared type for one column, and AGENTS.md puts
that migration out of scope. `/users` Estado renders bare text today
(`UsersTable.tsx:212`) and is the only place a real enum column has no badge, so it gets
`components/ui/badge.tsx`. Service orders already badge through `StatusBadge`
(`service-orders/page.tsx:149`) — unchanged. Customers keeps its inline "Desactivado" pill
(`customers/page.tsx:252`), which is already a badge. Inventory gets none: no
small-cardinality enum column exists there.

## D9 — Bulk status change offers only what is legal for the whole selection

`getAllowedTransitions(from)` (`transitions.ts:48` — the proposal says 45; the symbol is what
counts) is pure and already called from a `"use client"` component
(`OrderStatusControls.tsx:9,30`), so the menu can compute
`selection.map(row => getAllowedTransitions(row.status)).reduce(intersect)` in the browser with
no round trip. An empty intersection disables the action with copy saying why, which removes
most of the "legal for one row, illegal for another" reporting before it happens. Rows that
still fail — the selection changed under a stale page — come back as `invalid_transition` and
land in the result panel per row.

`STATUS_LABEL` is currently declared **twice** (`service-orders/page.tsx:28-33` and
`OrderStatusControls.tsx:11`); the bulk menu needs it as a third. It moves into
`transitions.ts`, which both files already import — a net deletion, in the file that already
owns the state machine.

Confirmation copy must say what the proposal's rollback plan says: `done` and `cancelled` have
no outgoing edges (`transitions.ts:28-33`), so a bulk move to either is **terminal and cannot
be undone through the UI**.

## D10 — Inventory → builder: a URL of ids, one route branch, one new query

The smallest entry point that is honest about what it costs.

```
/inventory  ──selection──▶  /builder?products=id1,id2,…   (client navigation, ≤200 ids)
                                 │ builder/page.tsx parses → seedProductIds: string[]
                                 ▼
CatalogBuilderForm ──POST /api/catalog-builder/products { productIds }──▶ listProductsByIds()
                                 │ same projection as listProductsInCategories
                                 ▼  candidates + all ids pre-selected, category tree empty
```

Four costs, none of them hidden:

1. **`POST /api/catalog-builder/products` gains a `productIds` branch** beside `categories`
   (`route.ts:21-23` accepts categories only today). Same route, same `catalogs.read` gate, so
   no new `ROUTE_GUARDS` entry and no new permission surface.
2. **`listProductsByIds(ids)` is new SQL** — and it must reuse
   `listProductsInCategories`' projection verbatim (`catalog-builder/queries.ts:37-72`:
   `image`, `imageType`, and the two-guard `priceLists` aggregate). A thinner projection
   silently degrades the review step and the printed prices. This is the **only** new SQL in
   the change and therefore the only thing that needs a throwaway Postgres.
3. **The builder gains a second selection mode.** With `seedProductIds`, `candidates` come from
   ids and `selectedCategories` stays empty — which means `deriveCatalogTitle(uniqueL1s(…))`
   has nothing to derive from and must fall back to the distinct L1s carried on the returned
   rows.
4. **The 200 cap becomes visible on `/inventory`.** `MAX_TOTAL_PRODUCTS = 200`
   (`selection.ts:51`) already exists; the bar refuses a larger selection **before navigating**,
   in Spanish, rather than letting the builder reject it after the jump.

**Rejected — `sessionStorage`**: invisible, dies in a new tab, and unreadable in a bug report.
**Rejected — a handoff row in Postgres**: a table, a migration and a cleanup job for a
navigation. **Accepted cost of the URL**: 200 ids is roughly 2 KB of query string — ugly, well
inside browser limits, survives a reload, and is pasteable into a bug report.

The proposal's known limitation stands: without server-side select-all this means ticking rows
across many pages, which is why "seleccionar los N que coinciden con el filtro" is a
`tasks.md` follow-up and not this change.

---

## Data Flow

```
tick a row ─▶ useRowSelection: Set<id> + Map<id,label>   (client, survives paging)
                    │
 filterKey changes ─┤─▶ Reconcile=dropAll ─▶ [] + "se limpió la selección (12)"   D5
                    │
   press an action ─┴─▶ runSequential(ids, signal, fn)                            D2
                             │  await one PATCH per row, abort-checked between
                             ▼
                   PATCH /api/{customers,users,service-orders}/[id]
                             │  own request → own transaction → own precondition read
                             ▼
                   200 → ok · 400 {error:"last_active_admin"|"invalid_transition"} → reason
                             ▼
                   BulkResultPanel: per row → label + Spanish reason
```

## File Changes

| File | Action | Description | Unit |
|---|---|---|---|
| `src/components/ui/table.tsx` | Modify | header fill on `TableHeader`; nothing else (D7) | 1 |
| 3 `loading.tsx`, `CustomerPicker`, `CatalogBuilderForm`, 3 detail sub-tables | Verify | inherit the fill; two sit in dialogs | 1 |
| `src/shared/ui/selection/RowActions.tsx` | Create | kebab trigger `min-h-11 min-w-11` + portal content (D6) | 2 |
| `src/app/(app)/{customers,inventory,service-orders}/page.tsx` | Modify | kebab replaces the inline links (two of them `h-7`); checkbox column; `SelectionProvider` props | 2,4,6,7 |
| `src/modules/account/UsersTable.tsx` | Modify | Card wrap, Estado badge, kebab, selection, two bulk buttons | 3,5 |
| `src/modules/account/UsersTable.test.tsx` | Modify | the 12 concentrated button-name assertions | 3 |
| `src/shared/bulk/run-sequential.ts` | Create | single-flight, abortable runner (D2) | 4 |
| `src/shared/ui/selection/{useRowSelection.ts,SelectionProvider.tsx,SelectionBar.tsx,RowCheckbox.tsx,BulkResultPanel.tsx}` | Create | shared selection model + bar + per-row result (D4) | 4 |
| `src/modules/account/refusals.ts` | Create | `REFUSAL_MESSAGES` promoted out of `UsersTable.tsx:94-99`, one copy for row action and bulk panel | 5 |
| `src/modules/service-orders/transitions.ts` | Modify | `STATUS_LABEL` moves here; two duplicates deleted (D9) | 6 |
| `src/modules/catalog-builder/queries.ts` | Modify | `listProductsByIds` — the only new SQL (D10) | 7 |
| `src/app/api/catalog-builder/products/route.ts` | Modify | `productIds` branch beside `categories` | 7 |
| `src/app/(app)/builder/page.tsx`, `CatalogBuilderForm.tsx` | Modify | `?products=` → `seedProductIds`; id-seeded selection mode; title fallback | 7 |
| `src/shared/ui/StatusBadge.tsx`, every `api/**/route.ts`, `ROUTE_GUARDS` | **Unchanged** | consequence of D1/D8 — no new route, no new action | — |

## Interfaces

```ts
// src/shared/bulk/run-sequential.ts — pure, DB-free, node project
export type RowOutcome = { id: string; ok: boolean; reason?: string };
export async function runSequential(
  ids: readonly string[],
  apply: (id: string) => Promise<RowOutcome>,
  signal?: { aborted: boolean },
): Promise<RowOutcome[]>;                 // one in flight, always. See D2.

// src/shared/ui/selection/useRowSelection.ts
export function useRowSelection(input: {
  pageIds: readonly string[];
  labels: Readonly<Record<string, string>>;
  filterKey: string;
  reconcile?: Reconcile;                  // default dropAll (D5)
}): {
  selected: ReadonlySet<string>;
  labelOf(id: string): string | undefined;
  toggle(id: string): void;
  togglePage(): void;
  clear(): void;
  clearedByFilter: number | null;         // drives the Spanish notice
};
```

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | `runSequential` never overlaps; abort stops before the next row; outcomes preserve input order | RED first; **mutation-verify with `Promise.all`** — it must fail by name (D2) |
| Unit (node) | intersection of `getAllowedTransitions` across a mixed selection; empty intersection | pure, beside `transitions.test.ts` |
| Component (jsdom) | filter change clears the selection and prints the Spanish count (D5); "12 seleccionados" with 3 rows on screen lists the off-screen rows by label; select-all-on-page tri-state | `UsersTable.test.tsx` idiom; assert the **Spanish string**, never loosened |
| Component (jsdom) | both remaining admins selected → one PATCH issued, second refused, panel names the row with `last_active_admin` | injected `fetch`, assert call order |
| Real Postgres (throwaway, **not** `npm test`) | `listProductsByIds` — the one new SQL, its projection, and a >200 refusal; the two-admin bulk deactivate end to end; a mixed-status bulk transition applying the legal rows only | AGENTS.md: a green suite **proves** zero real-SQL coverage; Docker is broken, use a native throwaway DB |
| **Browser, console open — the only evidence that exists** | each of the four new client boundaries renders at all (RSC serialization refusal is invisible to jsdom); the kebab portal does not throw a hydration mismatch; selection held across page 1 → page 3 with 368 customers and ~700 inventory pages; every kebab trigger measured ≥44×44 | per unit, in the PR body. **No test asserts a button height and jsdom cannot see an RSC boundary** |

Two AGENTS.md limits are load-bearing here and neither is optional: this change adds four
client boundaries plus a portal-backed menu, and the volume-dependent bug class (`Pagination`
returning `null` at one page) is exactly what cross-page selection reproduces.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. Two untrusted-input surfaces exist and are closed: `?products=`
is capped at `MAX_TOTAL_PRODUCTS` and resolved by an id lookup, so an unknown id returns no row
rather than an error; and every bulk write goes through an existing route whose validation,
`can()` gate and refusal codes are unchanged by this design (D1).

## Migration / Rollout

No migration, no schema change, no new route, no new policy action. Seven units per the
proposal, feature-branch-chain, tracker draft until all land. Each unit is additive and
independently revertable; reverting 5/6/7 leaves an inert checkbox column, reverting 4 removes
selection, reverting 1 restores the bare table.

One asymmetry the code cannot roll back: a bulk transition to `done` or `cancelled` is terminal
(D9). The confirmation copy says so.

## Open Questions

- [ ] **Filter rule** — `sdd-spec` owns keep/drop/warn. This design builds `dropAll` behind a
      `Reconcile` seam (D5); switching to server-resolved survivors is one function plus one
      route per capability, and that route re-opens D2's argument.
- [ ] **Users mixed selection** — two buttons is decided. Open: are both always enabled and
      scoped to eligible rows, or disabled when the selection has none? Preference: always
      enabled, ineligible rows reported per row, so the button set does not flicker.
- [ ] **`/inventory` page copy is English** ("Inventory", "No products found", "Category L1").
      Adding a Spanish bar and kebab ships a half-translated screen. Not this change's job —
      `tasks.md` carries it as a follow-up, deliberately.
- [ ] **`SELECT … FOR UPDATE` in `deactivateUser`** — closes the cross-operator race D2 names
      as pre-existing. New SQL, own change, `tasks.md` follow-up.
