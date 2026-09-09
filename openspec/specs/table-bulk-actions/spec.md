# Spec: table-bulk-actions

## Purpose

Shared list-table contract for Clientes, Inventario, Órdenes de servicio, and
Gestión de usuarios: a shaded header, a per-row kebab action menu, a checkbox
selection column that survives pagination, an explicit filter-vs-selection
rule, and per-row partial-success reporting for any bulk action built on top
of it. This capability owns the shell and the selection/reporting mechanics;
each consuming capability (`customer-management`, `service-orders`,
`catalog-generation`, `user-management`) owns what its own bulk action DOES.

## Requirements

### Requirement: Shaded Table Header, Container Unchanged

`table.tsx`'s `TableHeader` MUST render with a shaded background applied once
in the shared component, not per page. `Table` MUST NOT gain a border or
rounded container — the existing `Card`/`CardContent` wrapper on all four list
pages remains the sole container, avoiding a double border. `table.tsx`'s
other six consumers (customer/service-order detail sub-tables,
`CatalogBuilderForm`, `CustomerPicker`, three `loading.tsx` skeletons) MUST
continue to render without a visible double border after this change.

#### Scenario: Header shades once, container stays put
- GIVEN any of the four list pages, already wrapped in `Card`/`CardContent`
- WHEN the page renders
- THEN the header row MUST show the shaded background, and the page MUST show exactly one bordered container, not two

#### Scenario: In-dialog consumer unaffected
- GIVEN a `table.tsx` consumer rendered inside a dialog (e.g. `CustomerPicker`)
- WHEN it renders after this change
- THEN it MUST show the shaded header with no new border or container added around it

### Requirement: Kebab Row-Action Menu at 44x44

Each of the four tables MUST replace its inline row-action link(s) with a
single kebab-trigger button per row, opening a menu of that row's existing
actions. The kebab trigger MUST measure at least 44x44 (`min-h-11 min-w-11`),
regardless of any inherited `h-7` styling on the link it replaces. The menu
MUST NOT add, remove, or change what any existing single-row action does.

#### Scenario: Trigger meets the hit-target floor
- GIVEN the inventory or service-orders table, whose current "Ver" link is 28px
- WHEN the kebab replaces it
- THEN the rendered trigger MUST measure at least 44x44

#### Scenario: Existing actions unchanged
- GIVEN the users table's two actions (edit, activar/desactivar)
- WHEN they move into the kebab
- THEN each MUST behave identically to today, only relocated

### Requirement: Cross-Page Checkbox Selection

Each table MUST offer a checkbox column. Selecting a row MUST add its id to a
client-held selection set that survives changing page (or, on `/users`,
toggling `Mostrar inactivos`). The selection bar MUST state the total
selected count AND make the off-screen portion legible — at minimum,
distinguishing how many of the total are on the current page, with a way to
view or clear the full set. Selection MUST NOT survive a full page reload or
navigating away from the list route.

#### Scenario: Selection survives paging
- GIVEN 8 customers selected on page 1
- WHEN staff navigates to page 3 and selects 3 more
- THEN the bar MUST report 11 selected total, and returning to page 1 MUST show all 8 still checked

#### Scenario: Off-screen selection is legible, not just counted
- GIVEN 12 selected with only 3 visible on the current page
- WHEN staff reads the selection bar
- THEN it MUST communicate that 9 are selected off-screen, not print "12 seleccionados" with no further affordance

#### Scenario: Selection does not survive a reload
- GIVEN an active selection
- WHEN staff reloads the page or navigates away and back
- THEN the selection MUST be empty

### Requirement: Filter Change Clears the Selection

WHEN any filter parameter changes (search term, status, category,
`stockStatus`, or the `/users` `Mostrar inactivos` toggle), the system MUST
clear the entire current selection rather than attempt to keep the subset
that still matches. The system MUST NOT re-evaluate the new filter against
off-page rows to decide which to keep, because the client holds no data for a
selected row on a page it has not loaded. The UI MUST show a message in the
shape "Se limpió la selección de N al cambiar el filtro", where N is the size
of the selection that was cleared.

The copy MUST NOT claim the cleared rows failed to match. Clearing is
unconditional, so some of those N rows almost certainly DO match the new
filter — a message like "Se soltaron N que no coinciden con el filtro nuevo"
would be a string asserting more than the code does, and a test pinning it
would seal the lie in. Say what happened (the selection was cleared), not why
each row went.

*Why not a server round trip instead*: resolving which of N selected ids
still match a new filter needs a new match-checking query per table — the
same server-side selection support this change's proposal keeps explicitly
out of scope — for a benefit (keeping the still-matching subset) the operator
can already recover in one click by re-selecting.

#### Scenario: Any filter edit drops the whole selection
- GIVEN 12 rows selected across two pages
- WHEN staff changes the search term, a status filter, or a category filter
- THEN the selection MUST become empty and the UI MUST show "Se limpió la selección de 12 al cambiar el filtro"

#### Scenario: The message does not claim the cleared rows failed to match
- GIVEN 12 rows selected, of which 10 would still match the new filter
- WHEN staff changes a filter and the selection is cleared
- THEN the message MUST NOT assert that the cleared rows do not match the new filter, because 10 of them do

#### Scenario: Sort and pagination do not clear it
- GIVEN a live selection
- WHEN staff sorts a column or turns the page without changing any filter
- THEN the selection MUST be unaffected

#### Scenario: Users' visibility toggle counts as a filter
- GIVEN a selection that includes an inactive user, with `Mostrar inactivos` on
- WHEN staff turns `Mostrar inactivos` off
- THEN the selection MUST clear exactly as any other filter change would

### Requirement: Per-Row Partial Success Reporting

A bulk action MUST apply independently, per row, over the existing
single-row service call for that row's action — never a single batched
precondition check followed by a batched write. The result MUST report, per
row that did not apply, that row's identity (at minimum a human-readable
label — name, username, or order id) and its specific refusal reason; a bulk
result with unnamed failures ("2 no se pudieron") is not acceptable.

#### Scenario: Mixed result is fully named
- GIVEN a 5-row bulk action where 3 succeed and 2 fail for different reasons
- WHEN the result renders
- THEN it MUST list both failing rows by name, each with its own reason, alongside a count of the 3 that succeeded

### Requirement: Enum Column Badges

Where a table column already renders a small, fixed-cardinality state as
inline text or an ad-hoc span, the column MUST render using
`components/ui/badge.tsx` instead — the customers list's "Desactivado" marker
and the users table's "Activo"/"Inactivo" column. This MUST NOT apply to
service-orders' status column (`StatusBadge`, unchanged, out of scope) or to
any inventory column (no enum column exists there).

#### Scenario: Customer deactivated marker becomes a badge
- GIVEN a deactivated customer in the list
- WHEN the row renders
- THEN "Desactivado" MUST render as a `Badge`, not the current ad-hoc span

#### Scenario: Service-orders status is untouched
- GIVEN the service-orders list
- WHEN it renders
- THEN its status column MUST keep rendering through `StatusBadge`, unchanged

## What Does NOT Change

- Inventory gets no badge — its columns are free Interfuerza text; `stockStatus` remains a filter, not a column.
- No server-side "select all N matching the filter" (see Filter Change requirement above).
- Inventory's untranslated page copy ("Inventory", "No products found", "Clear filters", "Category L1") is a pre-existing violation of the Spanish-UI convention and is a follow-up, not part of this change.

## Verification Notes

- Customers, inventory, and service-orders each gain a new client boundary
  they do not have today, and the kebab menu portals (`dropdown-menu.tsx`).
  Per AGENTS.md, jsdom cannot see either failure mode — opening each page in
  a browser and reading the console IS the verification for the client
  boundary and for the portal, not a substitute for one.
- The cross-page selection and filter-clearing scenarios above need real data
  volume to exercise meaningfully (368 customers, ~700 inventory pages); a
  single-page dev dataset cannot exhibit them.
