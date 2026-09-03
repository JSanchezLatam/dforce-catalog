# Spec: customer-management

This spec consolidates R16–R19 from `crm-workshop-management` (baseline), adds access-control requirements from `crm-shell-settings-rbac`, incorporates the R19 modification from `customer-search-and-picker` (async search, accent-insensitivity, near-match fallback, route endpoint), and layers in the vehicle collection (soft/permanent delete) model from `vehicles-one-to-many` (C3) and per-vehicle service history plus the permanent-deletion referential-integrity check from `service-history-per-vehicle` (C4).

## REQUIREMENTS

### Requirement: Cliente Creation, Editing, Listing, and Detail View (R16)

The system MUST allow staff to create a native `cliente` record with: name, phone, email (optional), and zero or more vehicles, each recorded as a separate `vehiculo` record (make, model, year, plate — all optional as a group per vehicle, see R17 for the plate exception). Staff MUST be able to edit any field of an existing `cliente`, including adding, editing, or soft-deleting individual vehicles in its collection (see the Vehicle Collection Persistence requirement). The system MUST provide a paginated list view of all `cliente` records and a detail view for a single record. The detail view MUST include that customer's service-order history (see `service-orders` capability), ordered most-recent first.

Every route (list, create, detail, edit) MUST call `can()` for `customers.read`/`customers.write` after `requireSession()`, enforcing default-deny policy.

#### Scenarios

- GIVEN a staff user on the "New Customer" form WHEN they submit a valid name and phone THEN the system MUST create the `cliente` record and redirect to its detail view
- GIVEN a `cliente` with three vehicles WHEN staff opens its detail or edit view THEN the system MUST display all three
- GIVEN an existing `cliente` WHEN staff edits its phone number and saves without touching any vehicle THEN the system MUST persist only the phone field on `cliente` and leave every existing `vehiculo` row unchanged
- GIVEN more `cliente` records than fit on one page WHEN staff opens the customer list THEN the system MUST show a paginated table with at least name, phone, and a joined list of that customer's active vehicle plates (comma-separated, reusing `CustomerPicker`'s `plates.join(\", \")` convention) instead of a single fixed plate column
- GIVEN a `cliente` with one or more service orders WHEN staff opens its detail view THEN the system MUST display that customer's service-order history ordered most-recent first
- GIVEN a `cliente` with zero service orders WHEN staff opens its detail view THEN the system MUST show an empty-state message instead of an empty table with no explanation
- GIVEN a `tecnico` with a valid session WHEN they call any customer route THEN `can()` MUST evaluate `true` and the request MUST succeed exactly as it does today
- GIVEN an `administrador` with a valid session WHEN they call any customer route THEN `can()` MUST evaluate `true` and the request MUST succeed

### Requirement: Field Validation (R17)

`name` and `phone` MUST be required on create and edit; `email` MUST be optional, and a `cliente` MAY have zero vehicles. For each `vehiculo` record attached to a `cliente`, IF any field other than `plate` (make, model, year) is provided, THEN `plate` MUST also be provided for that same vehicle — a vehicle without a plate is not a usable record for service-order lookups. This rule MUST be evaluated independently per vehicle, never across the customer's whole collection. `phone` MUST match a loose international format (optional leading `+`, 7–15 digits, spaces/dashes/parentheses allowed as separators only). `email`, when provided, MUST match a standard email format.

#### Scenarios

- GIVEN a form submission with an empty `name` WHEN staff submits THEN the system MUST reject it with a validation error identifying `name` as required
- GIVEN a form submission with an empty `phone` WHEN staff submits THEN the system MUST reject it with a validation error identifying `phone` as required
- GIVEN a form submission with `phone = "abc123"` WHEN staff submits THEN the system MUST reject it as an invalid phone format
- GIVEN a form submission with `email = "not-an-email"` WHEN staff submits THEN the system MUST reject it as an invalid email format
- GIVEN a `cliente` submission with zero vehicles attached WHEN staff submits an otherwise-valid `cliente` THEN the system MUST accept it
- GIVEN a submission with one vehicle having `make = "Toyota"` and no `plate` WHEN staff submits THEN the system MUST reject it, requiring `plate` for that vehicle
- GIVEN a submission with two vehicles, one fully valid and one missing `plate` while carrying `make` WHEN staff submits THEN the system MUST reject the whole submission citing the invalid vehicle only, without changing how the valid vehicle's fields are treated

### Requirement: Duplicate Detection by Phone (R18)

`phone` MUST be unique across all `cliente` records. WHEN staff attempts to create a new `cliente` with a `phone` that already belongs to an existing record, THE system MUST block creation and present an error that links to the existing customer's detail view, so staff can update that record (e.g. add a note or correct data) instead of creating a fragmented duplicate. *Rationale: a phone identifies one billable, contactable person. This change already lets that person register more than one vehicle under the same `cliente`, so blocking a duplicate phone keeps service history consolidated under one customer instead of fragmenting it across near-duplicate records for the same owner.*

#### Scenarios

- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff attempts to create a new `cliente` with the same phone THEN the system MUST reject creation and show a link to the existing customer's detail view
- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff edits that same customer's own record without changing the phone THEN the system MUST NOT flag it as a duplicate of itself
- GIVEN two different customers WHEN staff edits customer B's phone to match customer A's existing phone THEN the system MUST reject the edit as a duplicate

### Requirement: List View Search and Filter (R19)

The customer list view MUST provide a text search input matching `cliente` records by partial, case-insensitive AND accent-insensitive match against `name`, `phone`, or any of that customer's active vehicle `plate`s. Accent folding MUST apply to both the stored plate and the search term (`unaccent()` on both sides), exactly as it already does for `name`. The plate match MUST be evaluated as an existence check over the customer's vehicle collection — matching if any one active vehicle's plate matches — not a single-column comparison; a customer with zero vehicles MUST still match on `name` or `phone` alone. The same matching MUST also be reachable through `GET /api/customers`, gated by `customers.read`, accepting `search`, `page`, and `pageSize` parameters. Each result MUST include a `plates: string[]` array of that customer's active vehicle plates (possibly empty) for disambiguation, replacing the single `vehiclePlate` field; a `cliente` with neither `phone` nor any plate on record MUST still render as an identifiable row, not a blank one. WHEN a search yields zero exact matches, the route MUST also return near matches produced from the same relaxed term — a shorter prefix for name/plate, and for `phone` the search TERM reduced to its last significant digits. The relaxation applies to the term only: the comparison still runs against the stored column verbatim, so this guarantee holds exactly as far as `normalizePhone` (`validation.ts`) has already stripped separators on write. A row written by any path that bypasses `normalizePhone` keeps its separators and is NOT covered. This is deliberately NOT fuzzy/similarity matching.

#### Scenarios

- GIVEN a `cliente` named "Juan Pérez" WHEN staff types "juan" in the search box THEN the system MUST show that customer in the filtered list
- GIVEN a `cliente` with an active vehicle plate "ABC-123" WHEN staff types "abc" in the search box THEN the system MUST show that customer in the filtered results
- GIVEN a `cliente` with three vehicles WHEN staff searches by the plate of the second or third vehicle THEN the system MUST return that customer, not only when the first vehicle's plate matches
- GIVEN a `cliente` with zero vehicles but a matching name or phone WHEN staff searches THEN the system MUST still return that customer
- GIVEN a `cliente` named "María GONZÁLEZ" WHEN staff types "maria gonza" — no accents, lower case — in the picker or the list-view search box THEN the system MUST show that customer as an exact match, and MUST NOT report zero matches or offer "create customer" as if none existed
- AND typing "maría gonzá", with the accents, MUST still match the same customer
- GIVEN a search term that matches no `cliente` WHEN staff submits it THEN the system MUST show an empty-results message rather than the full unfiltered list
- GIVEN staff clears the search box WHEN the input becomes empty THEN the system MUST show the full paginated customer list again
- GIVEN no `customers.read` WHEN calling `GET /api/customers?search=juan` THEN the system MUST reject with 403 before running any query
- GIVEN two `cliente` records named "Juan Pérez" with the same phone but different plates, plus a third with `phone = null` and zero vehicles WHEN `GET /api/customers?search=juan` is called THEN all three rows MUST be returned, the two Juans each carrying their own `plates` array, and the third rendering with a defined fallback label instead of blank fields
- GIVEN a `cliente` whose name only starts with "Juan" and another whose `phone` is stored as "+525512345678" (separator-free) WHEN searches for "Juan Alberto" and for "55 1234-5678" each yield zero exact matches THEN the system MUST return each `cliente` as a near match — by shorter prefix, and by reducing the search term to its last significant digits

### Requirement: Vehicle Collection Persistence, Soft Delete, and Permanent Deletion

When staff create or update a `cliente`, the system MUST persist any changes to that `cliente`'s vehicle collection (added, edited, soft-deleted, or permanently deleted vehicles) together with any `cliente` field changes in a single database transaction — both succeed or both roll back. A vehicle omitted from an update's vehicle payload MUST be left completely untouched. Editing one vehicle MUST NOT alter any of its sibling vehicles on the same customer.

**Soft deletion**: Deleting a vehicle MUST be a soft delete by default — the system MUST set a `deactivated_at` timestamp to the current time on the `vehiculo` row rather than removing the row. Soft-deleted vehicles MUST be excluded from the customer list-view plate column, R19 search, and `CustomerPicker` display. Restoring a previously soft-deleted vehicle (clearing `deactivated_at` back to NULL) MUST be supported and MUST NOT lose any of that vehicle's recorded fields. A vehicle with existing `orden_servicio` history MUST remain soft-deletable exactly like one without history — soft deletion never removes the row, so it is never a referential-integrity concern. This is the first soft-delete pattern introduced in the customer-facing code; its `deactivated_at` nullable-timestamp column and NULL/non-NULL semantics on the owned row set the standing convention any later soft-delete feature MUST follow, rather than inventing its own shape.

**Permanent deletion**: The system MUST also provide permanent deletion of a vehicle — physically removing the row — as a separate operation from soft deletion. Permanent deletion MUST be gated by the `customers.deleteVehicle` policy action, which MUST be `false` for `tecnico` and `true` for `administrador` — only administrators may permanently delete vehicles. A `tecnico` presented with the UI MUST see only the soft-delete (deactivate) affordance. Permanent deletion MUST be included in the collection update payload alongside soft-delete and edit operations, and MUST be rejected with 403 Forbidden before any validation or database work if the requesting user lacks `customers.deleteVehicle` authority. Permanent deletion of a vehicle that has one or more `orden_servicio` rows referencing it MUST additionally be refused: the check MUST run inside the same database transaction as the DELETE, immediately before it, querying `orden_servicio` for any row whose `vehiculoId` is in the delete set, and MUST reject the whole request with a Spanish `ClienteValidationError` under the bare `vehicles` key — the same 400 shape `CustomerForm` already renders — instead of a raw foreign-key-violation 500. `ON DELETE RESTRICT` on `orden_servicio.vehiculoId` remains the backstop for any path that bypasses this check.

The schema migration that introduces `vehiculo` MUST preserve existing data: for every `cliente` row that had any inline vehicle field set, the migration MUST create exactly one `vehiculo` row carrying that make, model, year, and plate, with `deactivated_at = NULL`.

#### Scenarios

- GIVEN a `cliente` with one existing active vehicle WHEN staff adds a second vehicle and saves THEN the system MUST insert the new `vehiculo` row and leave the first vehicle's row unchanged, in one transaction with any `cliente` field changes
- GIVEN a `cliente` with two vehicles WHEN staff edits only the first vehicle's plate and saves THEN the system MUST update only that `vehiculo` row, leaving the second vehicle's row and every `cliente` field unchanged
- GIVEN a `cliente` with one active vehicle WHEN staff soft-deletes it THEN the system MUST set that `vehiculo` row's `deactivated_at` timestamp to the current time, MUST NOT delete the row, and the vehicle MUST no longer appear in the list view, R19 search results, or `CustomerPicker`
- GIVEN a previously soft-deleted vehicle WHEN staff restores it THEN the system MUST clear `deactivated_at` back to NULL and the vehicle's make, model, year, and plate MUST be exactly as recorded before the delete
- GIVEN a `cliente` update patch that edits only the phone field and includes no vehicles WHEN staff saves THEN every existing `vehiculo` row for that `cliente` MUST remain unchanged, including each row's `deactivated_at` timestamp
- GIVEN the pre-migration `cliente` row carrying inline vehicle fields WHEN the schema migration runs THEN the system MUST create exactly one `vehiculo` row for it, preserving make, model, year, and plate, with `deactivated_at = NULL`
- GIVEN a `tecnico` with a valid session WHEN they attempt to permanently delete a vehicle THEN the system MUST reject the request with 403 Forbidden before any database work
- GIVEN an `administrador` with a valid session WHEN they permanently delete a vehicle with zero `orden_servicio` rows referencing it THEN the system MUST physically remove that `vehiculo` row from the database in the same transaction as any other `cliente` field changes
- GIVEN a `vehiculo` with one or more `orden_servicio` rows referencing it WHEN an `administrador` attempts to permanently delete it THEN the system MUST reject the request with a Spanish 400 validation error under the `vehicles` key and MUST NOT delete the row
- GIVEN that same `vehiculo` with service history WHEN staff soft-deletes it instead of requesting permanent deletion THEN the system MUST set `deactivated_at` exactly as for a vehicle with no history, and its service-order history MUST remain intact and queryable

### Requirement: Vehicle Detail Screen with Service History

The system MUST provide a vehicle detail screen at `/customers/[id]/vehicles/[vehicleId]`, reachable by clicking a vehicle card on the customer detail view. The screen MUST show that vehicle's identity fields (plate, make, model, year) and a list of its own `orden_servicio` history, ordered most-recent-first. Each history row MUST offer a detail affordance that navigates to the existing `/service-orders/[id]` page rather than duplicating that page's content. A vehicle with zero service orders MUST show an explicit empty-state message instead of an empty table.

#### Scenarios

- GIVEN a `cliente` detail view WHEN staff clicks one of its vehicle cards THEN the system MUST navigate to that vehicle's `/customers/[id]/vehicles/[vehicleId]` screen
- GIVEN two vehicles belonging to the same customer, each with service orders WHEN staff opens the first vehicle's detail screen THEN the system MUST list only that vehicle's orders, most-recent-first, excluding the second vehicle's orders
- GIVEN a vehicle detail screen with at least one history row WHEN staff clicks that row's detail affordance THEN the system MUST navigate to `/service-orders/[id]` for that exact order
- GIVEN a vehicle with zero `orden_servicio` rows WHEN staff opens its detail screen THEN the system MUST show an empty-state message instead of an empty table
- GIVEN a soft-deleted (deactivated) vehicle that has service-order history WHEN staff navigates directly to its detail screen (e.g. via an order's vehicle link) THEN the system MUST still render the vehicle's identity and its full history
