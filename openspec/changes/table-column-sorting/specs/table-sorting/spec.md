# Table Sorting Specification

## Purpose

User-selectable column ordering for the four real HTML list tables
(`/customers`, `/inventory`, `/service-orders`, `/users`). `/catalogs` is a
card grid with no columns and is out of scope.

## Requirements

### Requirement: Per-Table Sortable Column Whitelist

Each table MUST expose a fixed whitelist of sortable columns. A column not on
the whitelist MUST NOT render a clickable header.

| Table | Sortable | Excluded — reason |
|---|---|---|
| Customers | `name`, `phone`, `email` | `plates` (Vehículos) — see the Conditional Vehicles Column requirement |
| Inventory | `id`, `name`, `categoryL1`, `categoryL2` | `stock`, `price` — fetched but not rendered as a header column |
| Service orders | `id`, `status`, `appointmentAt` | `description` — unindexed free text, no user-meaningful order |
| Users | `username`, `name`, `email`, `role`, `estado` | `Acciones` — not data |

#### Scenario: Non-whitelisted column has no header control

- GIVEN the inventory list view
- WHEN staff views the `stock` or `price` columns
- THEN neither renders a clickable header, whitelisted or otherwise

### Requirement: Server-Side Full-Result-Set Sort with Page Reset

For `/customers`, `/inventory`, and `/service-orders`, clicking a whitelisted
header MUST sort the entire result set in the database, not only the rows on
the current page, and MUST reset pagination to page 1.

#### Scenario: Sorting orders the full dataset

- GIVEN a table with more rows than fit on one page
- WHEN staff clicks a whitelisted header
- THEN the system MUST re-query with that column as the `ORDER BY` and return page 1
- AND the sort MUST apply across every page, not only the rows already loaded

#### Scenario: Changing sort resets an active page number

- GIVEN staff is on page 3 of a filtered list
- WHEN staff clicks a whitelisted header
- THEN the resulting URL MUST have `page` removed or set to 1

### Requirement: Invalid or Unknown Sort Parameter Falls Back to Default

An unrecognized or hand-typed `sort` or `dir` value MUST render that table's
existing default order. It MUST NOT error and MUST NOT return an unfiltered
dump of all rows.

#### Scenario: Garbage sort parameter is ignored

- GIVEN a hand-typed URL with `?sort=nonexistentColumn&dir=sideways`
- WHEN the page renders
- THEN the system MUST render today's default order for that table
- AND MUST NOT throw an error or bypass active filters

### Requirement: Sortable Header Control

For `/customers`, `/inventory`, and `/service-orders`, the interactive
element on a whitelisted header MUST be a real `<a>` (a Next.js `<Link>`)
whose `href` the Server Component page builds — not a `<button>`. A
client-side click handler there would require a new client boundary around
the header, which is exactly the "server function handed to a client
component" defect class already documented at
`customers/page.tsx:266-278`; and `router.push` from a new sort control would
be a second URL writer outside `CustomerFilters`' `pushedParamsRef`, the
failure `CustomerFilters.tsx:94-102` already names and has shipped twice. A
plain navigable link avoids both.

For `/users`, the interactive element MUST remain a real `<button>`.
`UsersTable.tsx` is already `"use client"` and sorting there has no URL to
navigate to (see the Client-Side Sort exception below) — a `<button>` is not
crossing any boundary that a `<a>` would need to avoid.

In both cases the header lives inside the existing `TableHead`, which itself
remains unchanged, and the header currently sorted MUST carry `aria-sort` set
to `"ascending"` or `"descending"` matching the active direction — `aria-sort`
is a `TableHead` attribute and is unaffected by whether its child is an `<a>`
or a `<button>`.

#### Scenario: Active header exposes aria-sort

- GIVEN a table sorted ascending by a whitelisted column
- WHEN that header renders
- THEN it MUST carry `aria-sort="ascending"`
- AND every other header on that table MUST NOT carry `aria-sort="ascending"` or `"descending"`

#### Scenario: Server-side table header is a link, not a button

- GIVEN the `/customers`, `/inventory`, or `/service-orders` list view
- WHEN a whitelisted header renders
- THEN its interactive element MUST have the accessibility role `link` (a real `<a>`/`<Link>`), reachable via `getAllByRole("link")` exactly as `page.test.tsx:130-142` already asserts for pagination
- AND it MUST NOT have the accessibility role `button`

#### Scenario: Users header stays a button

- GIVEN the `/users` list view
- WHEN a whitelisted header renders
- THEN its interactive element MUST have the accessibility role `button`, because there is no URL to navigate to and the component is already client-side

### Requirement: Unsorted Default Is Byte-Identical to Pre-Change Behavior

A user who never interacts with sorting MUST see the exact same row order as
before this change, on all four tables — `desc(createdAt)` for customers and
service orders, `asc(name)` for inventory, and the existing unspecified
`SELECT` order for users (no `ORDER BY` is added there).

#### Scenario: No sort parameter present

- GIVEN a table with no `sort` or `dir` in the URL (or, for users, no sort interaction)
- WHEN the list renders
- THEN row order MUST be identical to the table's order before this change shipped

### Requirement: NULL Ordering for Nullable Sort Columns

`appointmentAt` (service orders) and users' `name` and `email` MAY be NULL.
Rows with a NULL value in the active sort column MUST sort last, regardless
of ascending or descending direction — a missing value is never more
prominent than a present one, in either direction.

#### Scenario: NULL appointment sorts last ascending

- GIVEN service orders where some have `appointmentAt = NULL`
- WHEN staff sorts ascending by `appointmentAt`
- THEN rows with a NULL `appointmentAt` MUST appear after every row with a real date

#### Scenario: NULL appointment sorts last descending

- GIVEN the same data
- WHEN staff sorts descending by `appointmentAt`
- THEN rows with a NULL `appointmentAt` MUST still appear last, not first

### Requirement: Role Sorts by Displayed Label

Sorting the users table by `role` MUST compare the label shown to staff
(`ROLE_LABELS[role]` — `tecnico` → `"Técnico"`, `administrador` →
`"Administrador"`), never the raw enum value, so the visible order always
matches the visible text.

#### Scenario: Role sort matches what is on screen

- GIVEN users with both roles present
- WHEN staff sorts by `role` ascending
- THEN the row order MUST match alphabetically sorting `"Administrador"` and `"Técnico"`, not the raw `administrador`/`tecnico` enum strings

### Requirement: Client-Side Sort for /users (Justified Exception)

`/users` sorting MUST run entirely client-side, over the array `UsersTable`
already holds in memory — no `searchParams`, no `router.push`, no
server-side `ORDER BY`. This is a deliberate, permanent exception, not an
inconsistency to "fix" later by symmetry: `/users` has no pagination and no
existing URL-parameter plumbing on its page, so adding server-side sorting
would be scaffolding built for a table that cannot benefit. Revisit this
exception only if `/users` gains pagination. Sorting names or emails MUST use
locale-aware comparison (`localeCompare("es")`) so accented characters order
correctly.

#### Scenario: Sort survives no round trip

- GIVEN the users list already rendered in the browser
- WHEN staff clicks a whitelisted header
- THEN the table MUST re-order using the array already in memory, with no network request

#### Scenario: Accented names sort correctly

- GIVEN users named "Ángela" and "Bruno"
- WHEN staff sorts by `name` ascending
- THEN "Ángela" MUST sort before "Bruno", matching Spanish locale collation

### Requirement: Conditional Vehicles Column for Customers

Whether `plates` (Vehículos) is sortable is UNVERIFIED and MUST NOT be
assumed. `plates` is a correlated `sql<string[]>` aggregate alias
(`vehicles.ts:78-81`), not a plain column; whether Drizzle's `.orderBy()` can
target that alias is unconfirmed. `plates` MUST be excluded from the v1
whitelist unless a throwaway-database check during implementation proves
`.orderBy()` works against it AND the resulting array-lexicographic order
reads sensibly to a reviewer. If either condition fails, `plates` MUST stay
off the whitelist and no header MUST render for it.

#### Scenario: Plates excluded pending verification

- GIVEN the v1 customers list view
- WHEN staff views the Vehículos column
- THEN it MUST NOT render a clickable header unless implementation-time verification proved both conditions above

### Requirement: `/api/customers` Sort Divergence Is Deliberate

`GET /api/customers` (`handleListClientes`, consumed by `CustomerPicker`)
MUST NOT accept or parse a `sort` parameter. `listClientes`'s new order
argument MUST be optional and default to today's `desc(createdAt)`, so this
route's behavior and output remain byte-identical to before this change.

#### Scenario: Picker behavior is unchanged

- GIVEN `CustomerPicker` calling `GET /api/customers`
- WHEN the route runs with no `sort` argument passed to `listClientes`
- THEN results MUST be ordered `desc(createdAt)`, exactly as before this change
