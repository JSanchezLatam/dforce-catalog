# Exploration — table-column-sorting

Mirrored from Engram `sdd/table-column-sorting/explore` (id 976). The exploring
agent had no Write tool, so the orchestrator wrote this copy; both stores hold
the same content.

## Critical correction to the premise

**"Five tables" is wrong.** `/catalogs` (`src/app/(app)/catalogs/page.tsx:12-50`)
renders `<CatalogGrid>` (`src/modules/catalog-storage/CatalogGrid.tsx:35-45`), a
`grid grid-cols-1 md:grid-cols-2` of `<CatalogCard>` components — zero `<Table>`
or `<TableHead>` anywhere in that file. There are no column headers to click.

It is **four real HTML tables** (`/customers`, `/inventory`, `/service-orders`,
`/users`) plus one card grid with no sort target. Applying "click a column
header" to `/catalogs` needs an explicit owner decision — out of scope, or a
different dropdown-based sort — before `sdd-propose` touches it.

## Per-table facts

### Customers

- Query `src/modules/customers/queries.ts:94-118` `listClientes()`, default
  `.orderBy(desc(cliente.createdAt))` (line 113).
- Page `src/app/(app)/customers/page.tsx:41-49`.
- URL writer: `CustomerFilters.tsx`'s single `commit()` (103-123) → `router.push`.
  `applyFilter` (125-131) deletes `page` on any filter change except pageSize —
  **the exact reset-to-page-1 pattern to replicate for sort**.
- Rendered columns: Nombre / Teléfono / Email / Vehículos / Acciones
  (`page.tsx:194-198`). `name`, `phone`, `email` are plain columns. `plates`
  (Vehículos) is `platesSubquery()` (`src/modules/customers/vehicles.ts:78-81`),
  a raw correlated `sql<string[]>` aggregate aliased in the select
  (`queries.ts:108`) — **not a plain column**. Whether Drizzle `.orderBy()` can
  target that alias is UNVERIFIED; even if it works the semantics are
  array-lexicographic, which is questionable UX for "sort by vehicles".
- Indexes: `cliente_name_idx` (`schema.ts:355`), `cliente_created_idx` (356).
  `phone` and `email` are unindexed.
- **API duplication is REAL**: `src/app/api/customers/route.ts`
  `handleListClientes` (30-83) independently reparses `page/pageSize/search/status`
  (39-47) and calls the same `listClientes`/`countClientes`. Live-called by
  `CustomerPicker.tsx:83`. A `sort` param must be validated there too or the two
  diverge.
- Tests: `queries.test.ts:141-159` only proves the injected-`queryFn` seam — the
  real `.orderBy` line never executes. `page.test.tsx` (285 lines) already
  asserts pagination-link building (130-156) — a natural RED-test home.
  `CustomerFilters.test.tsx` exists.

### Inventory

- Query `src/modules/inventory-view/queries.ts:89-114`, hardcoded
  `.orderBy(asc(producto.name))` (107), no override today.
- Page `src/app/(app)/inventory/page.tsx:36-44`.
- URL writer: `InventoryFilters.tsx` uses a simpler `pushParams()` (34-36) — no
  debounce-race guard or ref machinery, **unlike CustomerFilters**. The two
  filter components are NOT the same shape; a shared sort-URL helper cannot
  assume CustomerFilters' ref pattern.
- Rendered columns: ID / Name / Category L1 / Category L2 / Acciones (118-122).
  `stock` and `price` are fetched and filterable but NOT rendered, so they
  cannot be sortable columns today — there is no header to click.
- Indexes: `producto_name_idx` (`schema.ts:120`), composite
  `producto_category_idx` on `(categoryL1, categoryL2)` (119) — sorting by
  categoryL1 alone benefits, categoryL2 alone does not (not leftmost).
- API duplication: **none** — no `src/app/api/inventory/**` route exists.
- Tests: `inventory-view/queries.test.ts` covers only `normalizeFilters` and
  `computePageWindow` — zero coverage of `listInventory` itself. No
  `page.test.tsx` exists. **Thinnest test surface of the four real tables.**

### Service-orders

- Query `src/modules/service-orders/queries.ts:28-41`, hardcoded
  `.orderBy(desc(ordenServicio.createdAt))` (36).
- Page `src/app/(app)/service-orders/page.tsx:53-61`; `normalizeOrdenFilters`
  (41-44) reads only `status`.
- `ServiceOrderFilters.tsx` was **not read line-by-line** this pass — flagged as
  unread. Do not assume its URL-write shape matches either sibling.
- Rendered columns: ID / Estado / Descripción / Cita / Acciones (120-125), all
  plain `ordenServicio` columns.
- Indexes: `orden_status_idx` (`schema.ts:443`) covers Estado; `description` and
  `appointmentAt` are unindexed.
- API duplication: **none** — `src/app/api/service-orders/route.ts` has no GET
  handler (POST only).
- Empty at census time (0 rows) — visual verification needs seeded data.
- Tests: `queries.test.ts:22-30`, same injected-seam-only pattern. No
  list-level `page.test.tsx` (only `[id]/page.test.tsx`).

### Users

- Query `src/modules/account/queries.ts:45-61` `listUsers()` has **no
  `.orderBy()` at all**.
- Page `src/app/(app)/users/page.tsx:16-43` — **no `searchParams` parameter
  whatsoever**, the only one of the five pages with none. Calls
  `listUsers({includeInactive: true})` once and hands the full array to
  `UsersTable.tsx`.
- `UsersTable.tsx` filters via `useState` + `.filter()` (lines 41, 48) — no
  `router.push`, no URL state at all.
- This **contradicts constraint 3** as currently architected. Adding URL-based
  server sort here is a first-time lift (`page.tsx` needs `searchParams`,
  `listUsers` needs order params), not a mechanical repeat.
- Genuine option B: sort client-side in `UsersTable.tsx` over the
  already-fetched array — cheap, but breaks the server-side/URL-state
  constraints for this one table and is inconsistent with the other three.
- No pagination either.
- API: `src/app/api/users/route.ts` `handleListUsers` (19-36) exists and calls
  the same `listUsers()`, accepting only `includeInactive` — **no caller
  anywhere in client code**. Unused today, low divergence risk.
- Tests: `account/queries.test.ts:28-64`, same seam pattern. `UsersTable.test.tsx`
  exists — a natural RED-test home since the component already owns filter state.

### Catalogs

See the premise correction. `listAllCatalogs`/`listCatalogsForUser`
(`catalog-storage/queries.ts:35-41`) hardcode `.orderBy(desc(catalogs.createdAt))`,
with no pagination and no `searchParams` on the page — the same URL-plumbing gap
as `/users`. Index: `catalogs_user_created_idx` on `(userId, createdAt)`
(`schema.ts:210`).

## Shared infrastructure

- `computePageWindow` / `parsePageSize` (`src/modules/inventory-view/queries.ts:61-75`)
  are pure functions shared by customers/inventory/service-orders only; users and
  catalogs never adopted them. Neither handles ordering — a sort parser belongs
  as a **new sibling pure function in the same style**, not as a change to these
  two. `.orderBy()` already precedes `.limit()/.offset()` in every query, so
  composing sort with paging is mechanically trivial once the `orderBy` value
  comes from a validated whitelist.
- `TableHead` (`src/components/ui/table.tsx:68-79`) is a bare `<th {...props}>`
  (`React.ComponentProps<"th">`) with no internal button or click handling. It
  already passes through any `children` (a `<button>`) and any prop (`aria-sort`)
  via spread. **No shared-component change is required** — a local per-table
  wrapper is enough and keeps `table.tsx` untouched.
- Total `.orderBy()` calls repo-wide: 12, all literal columns.

## Approaches

### 1. Per-table sort whitelist, mirroring the `computePageWindow`/`parsePageSize` DI-seam pattern

One small `parseSort`/whitelist per query module; each page's header wraps a
`<button>` inside the existing `TableHead`, reusing whatever URL-write mechanism
that page's own Filters component already has.

- **Pros**: matches the established repo pattern exactly; no shared-component
  edits; small, independently reviewable, naturally chunkable into chained PRs
  (one work unit per table); the customers-`plates` and users-no-URL problems
  stay isolated one-offs instead of forcing a shared abstraction to absorb them.
- **Cons**: some duplicated whitelist/URL-parsing boilerplate across three or
  four near-identical tables until a real repeat justifies extracting a helper.
- **Effort**: Medium, ~4 work units.

### 2. One generic shared `useSortParams` hook / `SortableTableHead`

- **Pros**: single source of truth for URL read/write and `aria-sort` rendering,
  once every table adopts it.
- **Cons**: premature. `CustomerFilters` (ref-based race guard) and
  `InventoryFilters` (plain push) already write the URL differently, and Users
  has no URL-write at all. Forcing three-plus shapes into one hook before they
  are proven identical is what AGENTS.md's simplicity-first discipline warns
  against.
- **Effort**: Medium-High, upfront design before any table ships.

## Recommendation

Approach 1, one work unit per table. `/users` is its own explicit
client-vs-server-sort decision. `/catalogs` excluded unless the owner confirms a
different sort UI belongs there. Extract a shared hook only after two or more
tables prove the same URL-write shape in practice.

## Risks

- `/catalogs` is not a table — no column headers exist. Needs an owner scope
  decision before `sdd-propose`.
- `/users` has zero URL/pagination plumbing — first-time architecture addition.
- Customers' `plates` sortability via Drizzle is UNVERIFIED; may need exclusion
  from the v1 whitelist.
- `/api/customers` GET is a second live consumer of
  `listClientes`/`countClientes` — a `sort` param must be validated there too.
- `/service-orders` and `/catalogs` were empty at census time; manual
  verification needs seeded rows.
- Every query-module test uses the injected-`queryFn` seam, so the suite proves
  zero coverage of the real `.orderBy()` SQL. A RED test for the whitelist parser
  is straightforward, but the SQL itself still needs a real-DB smoke test per
  AGENTS.md's documented injected-seam limit.

## Ready for proposal

Yes for `/customers`, `/inventory`, `/service-orders` — the pattern is uniform
enough. `/users` needs the owner to pick client-side vs first-time server/URL
sort. `/catalogs` needs the owner to confirm it is in scope at all.
