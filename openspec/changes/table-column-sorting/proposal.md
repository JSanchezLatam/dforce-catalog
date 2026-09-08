# Proposal: Table Column Sorting

## Intent

The four list tables each ship one hardcoded order (`createdAt desc` for customers and
service orders, `name asc` for inventory, **no `ORDER BY` at all** for users). A user
looking for the newest appointment, a product by category, or an inactive account has to
page through instead of ordering the column they are already reading. Clicking a header
is the expected affordance and none of the four offers it.

## Scope

### In Scope

| Route | Sort | Mechanism |
|---|---|---|
| `/customers` | server-side | `?sort=&dir=` via `CustomerFilters.applyFilter` semantics |
| `/inventory` | server-side | `?sort=&dir=` via `InventoryFilters.pushParams` |
| `/service-orders` | server-side | `?sort=&dir=` via `ServiceOrderFilters.applyFilter` |
| `/users` | **client-side** | in-memory sort over the array `UsersTable` already holds |

- Fixed per-table column whitelist; unknown `sort`/`dir` falls back to today's default order.
- Changing the sort deletes `page` (the rule `applyFilter` already applies to every non-`pageSize` filter).
- `aria-sort` on the active header, a real `<button>` inside it. `TableHead` is unchanged.

**`/users` is a justified exception, not an inconsistency.** It has no pagination, no
`searchParams` on `page.tsx`, and the page already hands the entire array to the client
(`users/page.tsx:16-43`). It holds one row. URL plumbing + server ordering there would be
scaffolding for a table that cannot benefit. Do not "fix" this later by symmetry alone —
fix it when `/users` gains pagination.

### Out of Scope

- Multi-column sort.
- Sorting `/catalogs` — it is a `CatalogCard` grid with no columns (`CatalogGrid.tsx:35-45`); a sort UI there is a different change.
- A search box for `/service-orders`; pagination for `/users`; a shared `useSortParams` hook (the three Filters components do not share a shape).

## Sortable columns

| Table | Sortable | Excluded — reason |
|---|---|---|
| Customers | `name` (`cliente_name_idx`), `phone`, `email` | **`plates`/Vehículos** — a correlated `sql<string[]>` aggregate alias (`vehicles.ts:78-81`). *Whether Drizzle `.orderBy()` can target that alias is UNVERIFIED*; array-lexicographic order is also weak UX. Resolve by trying it against a throwaway DB in WU1; ship it only if it works **and** reads sensibly, else stays out. |
| Inventory | `id`, `name`, `categoryL1`, `categoryL2` | `stock`, `price` — fetched and filterable but **no header is rendered** (`inventory/page.tsx:118-122`), so there is nothing to click. |
| Service orders | `id`, `status` (`orden_status_idx`), `appointmentAt` | `description` — unindexed free text; alphabetical order carries no user meaning. One whitelist entry to reverse if the owner disagrees. |
| Users | `username`, `name`, `email`, `role`, `estado` | `Acciones` — not data. |

Unindexed sorts (`phone`, `email`, `appointmentAt`, `categoryL2` off the composite's
leftmost) are correct but unindexed; at ~368 customers this is a note, not a blocker.

## `/api/customers` divergence

`handleListClientes` (`api/customers/route.ts:30-83`) is a second live consumer via
`CustomerPicker.tsx:83`. **It does not get sorting and does not parse `sort`.** The picker
is a search-and-select popover, not a browsable table; nobody sends it a sort. The
requirement this places on WU1: `listClientes`' new order argument must be **optional and
default to today's `desc(createdAt)`**, so the route's behaviour is byte-identical and the
two cannot diverge on a param only one of them knows about.

## Approach

Per-table sort whitelist mirroring the existing `parsePageSize`/`computePageWindow`
pure-function pattern (`inventory-view/queries.ts:61-75`): parse + validate + return an
order value, composed into the existing chain before `.limit()/.offset()`. No shared
abstraction until two tables prove the same URL-write shape in practice.

Open for `sdd-design`: `router.push` is client-only, so the header `<button>` needs a small
client component per table (the pages are Server Components). The alternative — a `<Link>`
styled as a header, matching the pagination links `customers/page.test.tsx:130-156` already
asserts — conflicts with the stated `<button>` requirement.

## Capabilities

### New Capabilities

- `table-sorting`: user-selectable column ordering for the customers, inventory, service-orders and users tables, including URL state, whitelist validation, page reset and `aria-sort`.

### Modified Capabilities

- `customer-management`: R19 (List View Search and Filter) — list ordering becomes user-selectable alongside the existing filters.

*(The `service-orders` spec has no list-view requirement — verified, its requirements cover creation, vocabulary, notes, detail, lifecycle, parts and the async picker. Inventory and users have no spec file; their behaviour lands in `table-sorting`.)*

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/modules/customers/queries.ts` | Modified | Optional order arg on `listClientes`, default unchanged |
| `src/app/(app)/customers/page.tsx` | Modified | Sortable headers, sort read from `searchParams` |
| `src/modules/inventory-view/queries.ts` + `inventory/page.tsx` | Modified | Same, replacing the hardcoded `asc(name)` default |
| `src/modules/service-orders/queries.ts` + `service-orders/page.tsx` | Modified | Same; `normalizeOrdenFilters` also reads sort |
| `src/modules/account/UsersTable.tsx` | Modified | Client-side sort state beside the existing `showInactive` state |
| `src/app/api/customers/route.ts` | **Unchanged** | Deliberately; see divergence section |
| `src/components/ui/table.tsx` | **Unchanged** | `TableHead` already spreads `children` and `aria-sort` |

## Review Workload Forecast

- `Decision needed before apply: No` (cached `delivery_strategy: auto-chain`)
- `Chained PRs recommended: Yes`
- `400-line budget risk: High` as one PR; Low–Medium per slice

| # | Work unit | Est. changed lines | Verification |
|---|---|---|---|
| 1 | `/customers` | 220–300 | Richest existing surface: `page.test.tsx`, `CustomerFilters.test.tsx`, `queries.test.ts`. Also settles the `plates` question and the header-button shape. |
| 2 | `/inventory` | 200–260 | Thinnest surface — no `page.test.tsx`, no `listInventory` coverage. The unit adds both. |
| 3 | `/service-orders` | 180–240 | **0 rows at census.** Seed a throwaway DB with varied `status` and `appointmentAt` (including a NULL *Cita*), then verify in a browser. |
| 4 | `/users` | 120–160 | `UsersTable.test.tsx` exists and the component already owns filter state. |

**Stacked PRs to `main`, in that order** — no tracker branch: the units share no file
(constraint 3 forbids the shared hook), so each lands independently. Customers goes first
because it has the test surface to establish the pattern and owns the API question. *If*
WU2 ends up importing WU1's parser, that unit stacks on WU1 instead.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `plates` is not orderable via Drizzle | Med | Unverified by design; WU1 tries it against a throwaway DB and drops it from the whitelist if it fails |
| Green suite proves zero real-SQL coverage (AGENTS.md injected-seam limit) | High | Whitelist parser gets a real RED unit test; the `.orderBy()` SQL gets a throwaway-DB smoke test per unit |
| NULL ordering (`appointmentAt`, users' `name`/`email`) surprises the user | Med | Decide NULLS FIRST/LAST explicitly in the spec, do not inherit the Postgres default silently |
| Accented Spanish names sort wrong | Med | Client-side `/users` must use `localeCompare("es")`; server-side depends on DB collation — check once |
| Sorting `role` on the raw enum, not the displayed label | Low | `ROLE_LABELS` maps `tecnico → "Técnico de taller"`; sort the label so a third role stays correct |
| Header button crossing the RSC boundary (AGENTS.md's documented defect class) | Med | Browser check is the verification, not the suite |
| `/users` has no `ORDER BY` today, so "preserve the default" means preserving an arbitrary order | Low | Unsorted state renders the server array untouched; no `ORDER BY` is added |

## Rollback Plan

Every unit is additive and independently revertable. A stale bookmarked
`?sort=...&dir=...` against reverted code is ignored by the pre-change parser and the table
renders its original default order — no error state, no migration to undo.

## Dependencies

- A reachable throwaway Postgres for the per-unit SQL smoke test and for seeding `/service-orders` (Docker is broken here; use the native-Postgres recipe).

## Success Criteria

- [ ] Clicking a whitelisted header sorts the full result set (not just the current page) and returns to page 1.
- [ ] The active header carries `aria-sort` and the control is a real `<button>`.
- [ ] A user who never clicks sees exactly today's order on all four tables.
- [ ] A hand-typed `?sort=<garbage>` renders the default order rather than erroring.
- [ ] `CustomerPicker` is byte-identical in behaviour.
- [ ] `npm test` and `npx tsc --noEmit` clean per unit; every fix mutation-verified.
