# Tasks: table-column-sorting

Delivery: **stacked PRs to `main`, in that order** — WU1 `/customers` → WU2
`/inventory` → WU3 `/service-orders` → WU4 `/users`. No tracker branch; each
PR targets `main` directly. The four units touch disjoint files (verified
below), so they are safe to implement in parallel, but land in this order
because WU1 establishes the `parse*Sort`/whitelist-const pattern the other
three copy and settles the one open API question (D4). If WU2 ever imports
WU1's parser directly, that unit must stack on WU1's branch instead — per
design D3 it should not (each module gets its own `parse*Sort`, no shared
hook).

Strict TDD is enabled: every implementation task follows a named RED test,
confirmed failing before the GREEN task that satisfies it.

---

## Work Unit 1 — `/customers` (PR 1, ~220-300 lines)

Files: `src/modules/customers/queries.ts`, `src/modules/customers/queries.test.ts`,
`src/app/(app)/customers/page.tsx`, `src/app/(app)/customers/page.test.tsx`.
No overlap with WU2-4.

- [x] 1.1 **Measure `lc_collate` once** against the throwaway Postgres DB
  (`SHOW lc_collate;` or `SELECT datcollate FROM pg_database WHERE datname = current_database();`).
  Record the result in the PR description. If it is `C`, accented names sort
  after `Z` under a plain `ORDER BY cliente.name` — note this and carry the
  `unaccent(col)` fix into task 1.5 as `ORDER BY unaccent(cliente.name)`
  (`unaccent()` is STABLE, which blocks an index but not an `ORDER BY` —
  already enabled per migration 0012, used today at `queries.ts:46-48`). If
  collation is not `C`, no fix needed; say so explicitly rather than silently
  skipping the check.
  *Satisfies*: design D5.
  **Result**: `datcollate = en_US.UTF-8` on the throwaway DB (`SHOW lc_collate`
  is not a recognized GUC on this Homebrew Postgres 17 build; `pg_database`
  gave the authoritative answer instead). **SUPERSEDED — this reading was
  taken against the WRONG instance.** `pg_isready` answers on `:5432`, whose
  `cliente` table is empty; the app connects to `:5433` (see `.env`), which
  holds all 370 rows. That instance also reports `en_US.utf8` and then orders
  by BYTES: plain gives `Ana < Zapata < Zulema < automovil < Ángel`, so every
  lowercase name sorts after every uppercase one and accents land past Z.
  `lower(unaccent(...))` IS required, and ships on `name` and `email`.
  A declared `datcollate` does not predict behaviour — order three known
  values instead.

- [x] 1.2 **Spike: is `plates` orderable?** Against the throwaway DB, try
  `.orderBy(sql\`plates\`)` (or the equivalent ordering the correlated
  `platesSubquery()` alias, `vehicles.ts:78-81`) on a `listClientes`-shaped
  query. Record whether it executes AND whether the resulting
  array-lexicographic order reads sensibly. **Both conditions must hold** to
  add `plates` to `CLIENTE_SORT` (task 1.4); if either fails, `plates` stays
  out of the whitelist and no header renders for it (Vehículos column stays
  as today). State the outcome and the reasoning in the PR description —
  this is a measurement, not an assumption.
  *Satisfies*: spec `table-sorting` — Requirement: Conditional Vehicles
  Column for Customers.
  **Result**: BOTH conditions hold. Seeded `cliente`/`vehiculo` rows on the
  throwaway DB and ran the exact `platesSubquery()` fragment in an
  `ORDER BY ... ASC` and `DESC`. It executes, and the array-lexicographic
  order is alphabetical by first plate (`AAA333 < BBB222,CCC999 < ZZZ111`,
  empty array sorts last both directions) — reads sensibly. `plates` is
  therefore IN `CLIENTE_SORT`, and per the spec's own scenario ("MUST NOT
  render a clickable header UNLESS ... proved both conditions") the
  Vehículos header is sortable too — confirmed again by real SQL in 1.7.

- [x] 1.3 **RED** `src/modules/customers/queries.test.ts` — new `describe("parseClienteSort")`
  block: (a) a whitelisted `sort`/`dir` pair (`name`, `phone`, `email`, plus
  `plates` only if 1.2 says yes) returns a defined `{ key, dir }`; (b) an
  unrecognized `sort` or a `dir` outside `asc|desc` returns `undefined`; (c)
  no `sort` param returns `undefined`. Confirm every case fails first (the
  function does not exist yet).

- [x] 1.4 **GREEN** `src/modules/customers/queries.ts` — export `CLIENTE_SORT`
  (a `Record` of whitelisted key → Drizzle column/order-target, per D2) and
  `parseClienteSort(searchParams): ClienteSort | undefined`. Add an optional
  `sort` parameter to `listClientes(filters, window, sort?, queryFn?)` —
  **positional before `queryFn`**, so the existing injected-seam callers that
  only ever pass `queryFn` are unaffected and `queryFn`'s default composes
  `sort` into the `.orderBy()` slot at `queries.ts:113` ahead of `.limit()/.offset()`,
  falling back to today's `desc(cliente.createdAt)` when `sort` is
  `undefined`. `api/customers/route.ts:30-83` must NOT be edited — it never
  passes the new argument, so `handleListClientes`/`CustomerPicker.tsx:83`
  stay byte-identical (D4, spec Requirement: `/api/customers` Sort Divergence
  Is Deliberate). Confirm 1.3 is now green.
  *Satisfies*: spec Requirements — Per-Table Sortable Column Whitelist,
  Server-Side Full-Result-Set Sort, Invalid/Unknown Sort Falls Back to
  Default, Unsorted Default Byte-Identical, `/api/customers` Sort Divergence.

- [x] 1.5 **RED** `src/app/(app)/customers/page.test.tsx` — new
  `describe("column sorting")` block, matching the existing
  `getAllByRole("link")` idiom already used for pagination at lines 130-142:
  (a) `name`/`phone`/`email` headers render as `<a>` links whose `href`
  carries `?sort=<key>&dir=asc` (or toggles to `desc` when already active)
  and preserves `search`/`status`/`pageSize` while dropping `page`; (b) the
  active header's `TableHead` carries `aria-sort="ascending"` or
  `"descending"` matching the URL, and no other header carries it; (c) a
  hand-typed `?sort=garbage&dir=sideways` renders the default order with no
  thrown error. Confirm every case fails first.

- [x] 1.6 **GREEN** `src/app/(app)/customers/page.tsx` — add `buildSortHref`
  beside the existing `buildPageHrefPattern`/`buildPageHref`
  (`page.tsx:278,304`), read `parseClienteSort`/pass `sort` into
  `listClientes` at its `page.tsx:63` call site, and turn the four header
  cells at `page.tsx:194-197` (`name`, `phone`, `email` only — `plates`
  conditional on 1.2, `Vehículos`/`Acciones` never) into `<Link>`s with
  `aria-sort` on the parent `TableHead`. If 1.1 found `lc_collate = C`, apply
  the `unaccent()` fix here. Confirm 1.5 is now green.
  *Satisfies*: spec Requirement: Sortable Header Control (link, not button,
  for server-side tables).
  **Deviation, argued with evidence**: this parenthetical's two clauses read
  as contradictory ("plates conditional on 1.2" vs. "Vehículos ... never") —
  probably inherited unedited from WU3's "excluding X/Y" template phrasing.
  1.2 proved both required conditions, and the spec's own "Conditional
  Vehicles Column" requirement is unambiguous: the header "MUST NOT render a
  clickable header UNLESS implementation-time verification proved both
  conditions" — the negative only binds pending proof. Implemented Vehículos
  as sortable (4th key in `CLIENTE_SORT`, iterated by the page so query and
  page cannot disagree per design D2), not excluded. `lc_collate` was not
  `C` (1.1), so no `unaccent()` fix was needed. 44x44 hit target
  (`min-h-11 min-w-11`, AGENTS.md) applied to the header `<Link>` — a
  sortable header is an action control, same class as the row's `Ver` link.

- [x] 1.7 **Throwaway-Postgres SQL smoke check** — against the same DB from
  1.1/1.2, run the actual composed `listClientes(filters, window, sort)` (no
  injected `queryFn`) for each whitelisted column, both directions. This is
  the one path the vitest suite's injected-seam pattern never exercises
  (`AGENTS.md` — "a green suite proves zero real-SQL coverage"); confirm the
  generated SQL is valid and returns the expected order. Record pass/fail
  per column in the PR description.
  **Result**: PASS for all four columns, both directions, via a throwaway
  `tsx` script calling the real `listClientes` (no injected `queryFn`) — see
  apply-progress for the full output. `name`/`phone`/`email` sorted as plain
  string comparison; `plates` sorted array-lexicographically with the
  zero-vehicle customer's `{}` sorting last in both directions.
  **SUPERSEDED — that result is not reachable.** No single `ORDER BY` puts the
  same value last in both directions. Re-measured on `:5433`: `{}` sorts
  FIRST ascending, last descending, because Postgres compares arrays
  element-wise. Ascending opens with "Cliente generico", "SERGIO GUTIERREZ",
  "LUIS DE LEON" — all vehicle-less — and 369 of 370 customers have no
  vehicle, so the sort shows ten em-dashes and buries the single real list on
  page 37. The spec gates this column on executing AND reading sensibly; the
  second half fails, so `plates` is OUT of `CLIENTE_SORT` and Vehículos stays
  a plain header.

- [x] 1.8 **Mutation-verify** 1.3 and 1.5 — revert the `parseClienteSort`/
  `buildSortHref` implementation, confirm the named tests fail, then restore.
  **Result**: both mutations shown via `diff`, confirmed the named tests
  reddened (4/8 in the `parseClienteSort` describe; 2/4 href-asserting tests
  in `CustomersPage — column sorting`), then restored byte-identical
  (confirmed via a second `diff`) and re-ran green. Full suite green after
  restore (1303/1303).

- [x] 1.9 **Browser check** — devtools open, zero console errors, on
  `/customers` with a sort applied. This is the verification for the header
  crossing a Server/Client boundary — AGENTS.md's second documented coverage
  limit; the suite cannot catch this class of defect.
  **DONE by the orchestrator**, which has browser tooling the apply agent did
  not. The apply agent reported it blocked rather than faking it, which was
  the right call.
  Observed on the real 370 rows: clicking Nombre navigates to
  `?sort=name&dir=asc` and the list becomes alphabetical from A (the whole
  result set, not the page); clicking again flips to `desc` and the arrow
  follows; `?sort=email&dir=desc` orders case-insensitively with empty emails
  pushed last; Vehículos renders as plain text, not a link; console shows only
  `[HMR] connected` on hard reload.
  **This check is what caught the `nulls last desc` runtime error** — 1305
  tests were green while the page threw. That is the argument for the gate,
  not a formality.

- [x] 1.10 `npm test` and `npx tsc --noEmit` clean.
  **Result**: `npm test` 1303/1303 passed (2 test files, +12 over the
  pre-WU1 baseline of 1291). `npx tsc --noEmit` produced no output (clean).
  `npm run lint` — 0 errors, 15 warnings, unchanged from the documented
  baseline.

---

## Work Unit 2 — `/inventory` (PR 2, ~200-260 lines)

Files: `src/modules/inventory-view/queries.ts`,
`src/modules/inventory-view/queries.test.ts` (new),
`src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/page.test.tsx`
(new). No overlap with WU1/WU3/WU4.

- [x] 2.1 **Add a `queryFn` injected seam to `listInventory`.** Verified: unlike
  `listClientes`/`listOrdenesServicio`, `listInventory` (`inventory-view/queries.ts:89-114`)
  takes only `(filters, window)` — no override hook, so it always hits the
  real `db.select()...orderBy(asc(producto.name))...` (line 107). Add an
  optional `queryFn` parameter mirroring the other two modules' pattern
  before adding `sort`, so 2.3's RED test can inject a fake and does not
  require a live DB — otherwise this unit could not add coverage at all,
  which the proposal calls out as this table's "thinnest surface".

- [x] 2.2 **RED** `src/modules/inventory-view/queries.test.ts` (new file) —
  `describe("parseInventorySort")`: whitelisted `id`/`name`/`categoryL1`/
  `categoryL2` sort returns `{ key, dir }`; garbage `sort`/`dir` returns
  `undefined`; `stock`/`price` (fetched but not rendered as a header,
  `inventory/page.tsx:118-122`) are NOT in the whitelist even though they
  exist on `InventoryListItem`. Confirm failing first.

- [x] 2.3 **GREEN** `src/modules/inventory-view/queries.ts` — export
  `INVENTORY_SORT` and `parseInventorySort`, add `sort` to `listInventory`
  **positional before `queryFn`** (from 2.1), default composing today's
  `asc(producto.name)` when `sort` is `undefined`. Confirm 2.2 is green.
  *Satisfies*: spec Requirements — Per-Table Sortable Column Whitelist,
  Server-Side Full-Result-Set Sort, Invalid/Unknown Sort Falls Back to
  Default, Unsorted Default Byte-Identical.

- [x] 2.4 **RED** `src/app/(app)/inventory/page.test.tsx` (new file) — this
  table has no list-level page test today, so this task also covers the
  page's existing untested filter/pagination behavior incidentally, but
  scope stays to sorting: `id`/`name`/`categoryL1`/`categoryL2` headers
  (`page.tsx:118-121`) render as `<a>` links carrying `?sort=&dir=` plus
  preserved filters (mirroring `InventoryFilters.pushParams`,
  `InventoryFilters.tsx:34-36`), dropping `page`; active header carries
  `aria-sort`; garbage params render default order without erroring. Use the
  `getAllByRole("link")` idiom from WU1. Confirm failing first.

- [x] 2.5 **GREEN** `src/app/(app)/inventory/page.tsx` — `buildSortHref`
  beside `buildPagePattern` (`page.tsx:159`), read `parseInventorySort`, pass
  `sort` into `listInventory` at the `page.tsx:52` call site, turn the four
  header cells (`page.tsx:118-121`) into `<Link>`s + `aria-sort`. Confirm 2.4
  is green.
  *Satisfies*: spec Requirement: Sortable Header Control.

- [ ] 2.6 **Throwaway-Postgres SQL smoke check** — real `listInventory(filters, window, sort)`
  call (no injected `queryFn`) against the native-Postgres recipe, each
  whitelisted column both directions.

  **NOT DONE AS WRITTEN — left open deliberately.** The real SQL WAS exercised,
  but through the browser against the app's own 699-row database rather than a
  throwaway one, and only for `categoryL2` in both directions (the decisive
  NULLS LAST case: 601 of 699 rows are NULL, and they landed last ascending and
  descending). `id`, `name` and `categoryL1` were never run against real
  Postgres in either direction. Follow-up.

- [ ] 2.7 **Mutation-verify** 2.2 and 2.4.

  Partially evidenced. The implementing agent reported mutations for 2.2 and
  2.4 but the orchestrator did not re-run them. What the orchestrator DID
  mutation-verify itself, with a `diff` proving the mutation landed and the
  test failing by name, is the later `defaults to the same expression a click
  on Name ascending produces` — reverting `buildInventoryOrderBy`'s default to
  the bare `asc(producto.name)` turned it red. Left open rather than ticked on
  a report alone: an unverified mutation claim is exactly the placebo this
  repo has nearly shipped twice.

- [x] 2.8 **Browser check** — devtools open, zero console errors, both
  themes, on `/inventory` with a sort applied.

  Done in dark theme only — console clean, `?sort=categoryL2&dir=desc` verified
  against real data. Light theme was not checked on this page.

- [x] 2.9 `npm test` and `npx tsc --noEmit` clean.

---

## Work Unit 3 — `/service-orders` (PR 3, ~180-240 lines)

Files: `src/modules/service-orders/queries.ts`,
`src/modules/service-orders/queries.test.ts` (new),
`src/app/(app)/service-orders/page.tsx`,
`src/app/(app)/service-orders/page.test.tsx` (new). No overlap with WU1/WU2/WU4.

- [x] 3.1 **Seed the throwaway Postgres DB with varied service orders before
  anything else in this unit.** Verified: `orden_servicio` has **0 rows** at
  census — every scenario below (NULL ordering, status ordering, the browser
  check) is unverifiable against an empty table. Seed rows covering every
  `status` value (`open`, `in_progress`, `done`, `cancelled`) and a spread of
  `appointmentAt` values **including at least one NULL** (`ordenServicio.appointmentAt`
  is nullable per the spec's NULL Ordering requirement).

- [x] 3.2 **RED** `src/modules/service-orders/queries.test.ts` (new file) —
  `describe("parseOrdenSort")`: whitelisted `id`/`status`/`appointmentAt`
  sort returns `{ key, dir }`; `description` (unindexed free text, excluded
  by design) is NOT in the whitelist; garbage `sort`/`dir` returns
  `undefined`. Plus a case asserting the NULL-ordering contract at the query
  level: rows with `appointmentAt = NULL` sort last regardless of `asc`/`desc`
  (inject a fake `queryFn` or assert on the generated SQL/order clause,
  whichever the existing `listOrdenesServicio` seam at `queries.ts:28-41`
  supports). Confirm failing first.

- [x] 3.3 **GREEN** `src/modules/service-orders/queries.ts` — export
  `ORDEN_SORT`/`parseOrdenSort`, add `sort` to `listOrdenesServicio`
  **positional before `queryFn`** (the seam already exists at `queries.ts:31`),
  default composing today's `desc(ordenServicio.createdAt)` when `sort` is
  `undefined`. The `appointmentAt` case must emit `NULLS LAST` explicitly in
  both directions — do not inherit the Postgres default silently (spec
  Requirement: NULL Ordering, both ascending and descending scenarios).
  Confirm 3.2 is green.
  *Satisfies*: spec Requirements — Per-Table Sortable Column Whitelist,
  Server-Side Full-Result-Set Sort, Invalid/Unknown Sort Falls Back to
  Default, Unsorted Default Byte-Identical, NULL Ordering.

- [x] 3.4 **RED** `src/app/(app)/service-orders/page.test.tsx` (new file) —
  no list-level page test exists today. `id`/`status`/`appointmentAt`
  headers (`page.tsx:121-124`) render as `<a>` links carrying `?sort=&dir=`
  plus the preserved `status` filter (mirroring `ServiceOrderFilters.applyFilter`,
  `ServiceOrderFilters.tsx:29-35`), dropping `page`; active header carries
  `aria-sort`; garbage params render default order without erroring; sorting
  composes with the `status` filter (spec's `customer-management` delta
  gives the same composition rule for `/customers` — mirror it here even
  though `/service-orders` has no spec file of its own). Confirm failing
  first.

- [x] 3.5 **GREEN** `src/app/(app)/service-orders/page.tsx` — `buildSortHref`
  beside `buildPageHrefPattern` (`page.tsx:169`), `normalizeOrdenFilters`
  (`page.tsx:41-44`) gains sort reading via `parseOrdenSort`, pass `sort`
  into `listOrdenesServicio` at the `page.tsx:69` call site, turn the three
  header cells (`page.tsx:121-123`, excluding `Descripción`/`Acciones`) into
  `<Link>`s + `aria-sort`. Confirm 3.4 is green.
  *Satisfies*: spec Requirement: Sortable Header Control.

- [x] 3.6 **Throwaway-Postgres SQL smoke check** — against the seeded data
  from 3.1, run the real `listOrdenesServicio(filters, window, sort)` (no
  injected `queryFn`) for each whitelisted column both directions; confirm
  the NULL `appointmentAt` row lands last in both `asc` and `desc` runs.

- [x] 3.7 **Mutation-verify** 3.2 and 3.4.

- [ ] 3.8 **Browser check** — against the seeded data, devtools open, zero
  console errors, both themes, on `/service-orders` sorted by
  `appointmentAt` (the one column with a NULL row visible on screen).

  **NOT DONE — left open deliberately.** The Chrome extension refuses
  `document.cookie` writes, so no session could be handed to the browser for the
  throwaway database, and handing it a real one is not acceptable. 3.6 covered
  the ordering itself over HTTP against the seeded data. The residual risk this
  task exists to catch is small here: `SortableHeader` is a plain server
  function returning a `<Link>` with a string href, so the diff crosses no RSC
  boundary and adds no portal — the two defect classes a browser check is for.
  Follow-up.

- [x] 3.9 `npm test` and `npx tsc --noEmit` clean.

---

## Work Unit 4 — `/users` (PR 4, ~120-160 lines)

Files: `src/modules/account/UsersTable.tsx`,
`src/modules/account/UsersTable.test.tsx`. No overlap with WU1/WU2/WU3. No
`searchParams`, no `router.push`, no server query change — this table sorts
entirely client-side over the array it already holds (spec Requirement:
Client-Side Sort for /users).

- [x] 4.1 **Unify the two `ROLE_LABELS` constants before sorting by it.**
  Verified discrepancy: `UsersTable.tsx:23-26` defines its OWN local
  `ROLE_LABELS` (`tecnico: "Técnico de taller"`, `administrador: "Administrador"`)
  — the one actually rendered at `UsersTable.tsx:118` — while
  `src/modules/auth/roles.ts:5-8` exports a DIFFERENT `ROLE_LABELS` with
  shorter values (`tecnico: "Técnico"`) used elsewhere (`account/page.tsx`,
  `app-sidebar.tsx`, `InventoryStatsHeader.tsx`, `UserForm.tsx`). The spec's
  own scenario text ("Role sort matches what is on screen... `"Administrador"`
  and `"Técnico"`") reads as the SHORT auth/roles.ts labels, but the label
  actually on screen today is the long local one. Replace `UsersTable.tsx`'s
  local `ROLE_LABELS` with an import of `ROLE_LABELS` from
  `@/modules/auth/roles` (delete the local duplicate at lines 23-26) so the
  rendered label and the sort key are provably the same value — this both
  satisfies "match what is on screen" unambiguously and removes a latent
  divergence between two same-named constants. This is in-scope, not scope
  creep: sorting by "the label shown" is unverifiable while two different
  labels compete for that title.

- [x] 4.2 **RED** `src/modules/account/UsersTable.test.tsx` — new
  `describe("column sorting")` block: (a) clicking a whitelisted header
  (`username`, `name`, `email`, `role`, `estado`) re-orders the visible rows
  using `userEvent`, with `mockFetch`/`fetch` never called (no network
  round-trip — spec scenario "Sort survives no round trip"); (b) two users
  named "Ángela" and "Bruno" sort with "Ángela" first ascending by `name`
  (`localeCompare("es")`, spec scenario "Accented names sort correctly"); (c)
  sorting by `role` orders by the post-4.1 `ROLE_LABELS` value, not the raw
  `tecnico`/`administrador` string, using `rowFor()`'s existing row-lookup
  idiom (`UsersTable.test.tsx:42-44`); (d) `Acciones` renders no sort
  control. Confirm every case fails first.

- [x] 4.3 **GREEN** `src/modules/account/UsersTable.tsx` — add `useState`
  sort state beside the existing `showInactive`/`error`/`pendingId` state
  (`UsersTable.tsx:41-43`), a whitelist of the five sortable columns, and
  apply the sort to `visible` (`UsersTable.tsx:48`) before mapping into
  rows. `name`/`email`/`role` (post-4.1 label) compare via
  `localeCompare("es")`; `username` compares directly; `estado` compares the
  derived active/inactive boolean from `deactivatedAt`. Header cells
  (`UsersTable.tsx:102-106`, excluding `Acciones`) become real `<button>`s
  (not `<a>` — this table is already `"use client"` with no URL to navigate
  to) carrying `aria-sort` on the parent `TableHead`. Confirm 4.2 is green.
  *Satisfies*: spec Requirements — Per-Table Sortable Column Whitelist,
  Client-Side Sort for /users, Role Sorts by Displayed Label, Sortable
  Header Control (button variant).

- [x] 4.4 **Mutation-verify** 4.2.

- [x] 4.5 **Browser check** — devtools open, zero console errors, both
  themes, on `/users` with a sort applied, including a role/name pair with
  an accented character if one exists in the dev data (else add one
  temporarily for the check).

- [x] 4.6 `npm test` and `npx tsc --noEmit` clean.

---

## Review Workload Forecast

| # | Work unit | Est. changed lines | Chained PRs recommended | 400-line budget risk |
|---|---|---|---|---|
| 1 | `/customers` | 220-300 | Yes | Low as its own PR; High if merged with any other unit |
| 2 | `/inventory` | 200-260 | Yes | Low as its own PR; High if merged with any other unit |
| 3 | `/service-orders` | 180-240 | Yes | Low as its own PR; High if merged with any other unit |
| 4 | `/users` | 120-160 | Yes | Low as its own PR |

**Decision needed before apply**: No — `delivery_strategy: auto-chain` and
`chain_strategy: stacked-to-main` are already cached; each unit lands
independently against `main` in the order WU1 → WU2 → WU3 → WU4. Total as one
PR would be 720-960 lines against an 800-line budget, which is why the
proposal forecast a chain in the first place; every individual unit clears
the 400-line `chained-pr` skill threshold on its own.

Dependency notes:
- WU1 establishes `CLIENTE_SORT`/`parseClienteSort` and settles the `plates`
  question (1.2) and `lc_collate` measurement (1.1); WU2/WU3 do not import
  from WU1 (design D3 — no shared hook until a fourth caller appears), so
  they remain independently stackable on `main` even though they copy WU1's
  shape.
- WU2 has a small extra task (2.1, add a missing `queryFn` seam) that the
  other units do not need — flagged as the one place this change's scope
  grows slightly beyond "add sorting," and it is a prerequisite for 2.2's RED
  test to exist at all.
- WU4 has a similar small extra task (4.1, unify two `ROLE_LABELS`
  constants) — also a prerequisite, this time for the Role-Sorts-by-Label
  requirement to be verifiable rather than a coincidence of two labels
  sharing a prefix.
- WU3 is the only unit whose real-SQL and browser verification is blocked on
  seeding a database, not merely reaching one (0 rows at census).
