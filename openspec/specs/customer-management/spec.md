# Spec: customer-management

This spec consolidates R16–R19 from `crm-workshop-management` (baseline), adds access-control requirements from `crm-shell-settings-rbac`, incorporates the R19 modification from `customer-search-and-picker` (async search, accent-insensitivity, near-match fallback, route endpoint), and layers in the vehicle collection (soft/permanent delete) model from `vehicles-one-to-many` (C3) and per-vehicle service history plus the permanent-deletion referential-integrity check from `service-history-per-vehicle` (C4). R17, R18 and R19 were then rewritten by `customer-shared-phones` (C1) — a phone no longer identifies one person, and `cliente.phone` became `NOT NULL`; R16 and R19 again by `customer-deactivation` (C2), which added R20; and `customer-import` (C6) added R21. **R19 carries edits from both C1 and C2**, so those three archived in branch order — C1, C2, C6 — and applying them in any other order silently reverts one of them.

## REQUIREMENTS

### Requirement: Cliente Creation, Editing, Listing, and Detail View (R16)

The system MUST allow staff to create a native `cliente` record with: name, phone, email (optional), and zero or more vehicles, each recorded as a separate `vehiculo` record (make, model, year, plate — all optional as a group per vehicle, see R17 for the plate exception). Staff MUST be able to edit any field of an existing `cliente`, including adding, editing, or soft-deleting individual vehicles in its collection (see the Vehicle Collection Persistence requirement). The system MUST provide a paginated list view of all `cliente` records and a detail view for a single record. The detail view MUST include that customer's service-order history (see `service-orders` capability), ordered most-recent first. The list view MUST show only ACTIVE customers unless the operator explicitly asks for deactivated ones (see the Customer Deactivation requirement); the detail view MUST remain reachable for a deactivated customer, because reactivating a record requires opening it.

Every route (list, create, detail, edit) MUST call `can()` for `customers.read`/`customers.write` after `requireSession()`, enforcing default-deny policy.

#### Scenarios

- GIVEN a staff user on the "New Customer" form WHEN they submit a valid name and phone THEN the system MUST create the `cliente` record and redirect to its detail view
- GIVEN a `cliente` with three vehicles WHEN staff opens its detail or edit view THEN the system MUST display all three
- GIVEN an existing `cliente` WHEN staff edits its phone number and saves without touching any vehicle THEN the system MUST persist only the phone field on `cliente` and leave every existing `vehiculo` row unchanged
- GIVEN more `cliente` records than fit on one page WHEN staff opens the customer list THEN the system MUST show a paginated table with at least name, phone, and a joined list of that customer's active vehicle plates (comma-separated, reusing `CustomerPicker`'s `plates.join(", ")` convention) instead of a single fixed plate column
- GIVEN a `cliente` with one or more service orders WHEN staff opens its detail view THEN the system MUST display that customer's service-order history ordered most-recent first
- GIVEN a `cliente` with zero service orders WHEN staff opens its detail view THEN the system MUST show an empty-state message instead of an empty table with no explanation
- GIVEN a `tecnico` with a valid session WHEN they call any customer route THEN `can()` MUST evaluate `true` and the request MUST succeed exactly as it does today
- GIVEN an `administrador` with a valid session WHEN they call any customer route THEN `can()` MUST evaluate `true` and the request MUST succeed
- GIVEN a deactivated `cliente` WHEN staff opens the customer list without asking for deactivated records THEN the system MUST NOT list that customer
- GIVEN a deactivated `cliente` WHEN staff opens that customer's detail view directly THEN the system MUST render it, marked as deactivated

### Requirement: Field Validation (R17)

`name` and `phone` MUST be required on create and edit; `email` MUST be optional, and a `cliente` MAY have zero vehicles. For each `vehiculo` record attached to a `cliente`, IF any field other than `plate` (make, model, year) is provided, THEN `plate` MUST also be provided for that same vehicle — a vehicle without a plate is not a usable record for service-order lookups. This rule MUST be evaluated independently per vehicle, never across the customer's whole collection. `phone` MUST match a loose international format (optional leading `+`, 7–15 digits, spaces/dashes/parentheses allowed as separators only). `email`, when provided, MUST match a standard email format. `cliente.phone` MUST additionally be `NOT NULL` at the database level, matching the required status this requirement already gives it in the application.

*Rationale for the new clause: R17 has always rejected an empty `phone`
(`validation.ts`, `"Phone is required"`) and the column never agreed. A row
with no phone cannot be found by the phone search, cannot receive a WhatsApp
reminder, and has no way to enter through any current write path — so the
nullable column was permitting only states nothing produces.*

`NOT NULL` forbids a null, NOT an empty string. R19's guarantee that "a
`cliente` with neither `phone` nor any plate on record MUST still render as an
identifiable row" therefore STANDS UNCHANGED: "no phone on record" is now
spelled `''` instead of `NULL`, and every consumer already tests it by
truthiness (`schedule.ts:51`, `CustomerPicker.tsx:25`), not against null. No
defensive branch becomes dead, and no row shape stops rendering.

#### Scenarios

- GIVEN a form submission with an empty `name` WHEN staff submits THEN the system MUST reject it with a validation error identifying `name` as required
- GIVEN a form submission with an empty `phone` WHEN staff submits THEN the system MUST reject it with a validation error identifying `phone` as required
- GIVEN a form submission with `phone = "abc123"` WHEN staff submits THEN the system MUST reject it as an invalid phone format
- GIVEN a form submission with `email = "not-an-email"` WHEN staff submits THEN the system MUST reject it as an invalid email format
- GIVEN a `cliente` submission with zero vehicles attached WHEN staff submits an otherwise-valid `cliente` THEN the system MUST accept it
- GIVEN a submission with one vehicle having `make = "Toyota"` and no `plate` WHEN staff submits THEN the system MUST reject it, requiring `plate` for that vehicle
- GIVEN a submission with two vehicles, one fully valid and one missing `plate` while carrying `make` WHEN staff submits THEN the system MUST reject the whole submission citing the invalid vehicle only, without changing how the valid vehicle's fields are treated
- GIVEN the `cliente` table WHEN a row is inserted with a null `phone` by any path THEN the database MUST reject it
- GIVEN a `cliente` whose `phone` is the empty string WHEN reminders are planned for it THEN the system MUST skip the WhatsApp channel exactly as it did for a null phone

### Requirement: Duplicate Detection by Phone (R18)

A `phone` MUST NOT be assumed to identify exactly one person. WHEN staff
attempts to create a `cliente`, or to change an existing one's `phone`, to a
number that already belongs to a different `cliente`, THE system MUST refuse
that first attempt and present the existing customer as a link to their detail
view. THE system MUST also offer, in the same place, a way to confirm that the
number is genuinely shared and proceed; taking it MUST save the record. THE
confirmation MUST be an explicit act by the operator on that attempt — never a
default, never remembered, and never applied to a subsequent save.

*Rationale: R18 was written against staff re-creating a customer they could not
find, and PR #44's accent-insensitive search removed that cause at the root.
What the original wording did not allow for is a number that legitimately
belongs to two people — a house line, a shared handset. Three such pairs exist
in the current data, and under the old requirement the second person in each
pair could not be entered at all. The first refusal still does R18's real work,
which is making staff look at who already holds that number before deciding.*

THE system MUST NOT enforce phone uniqueness as a database constraint. Two
records with the same `phone` created concurrently are therefore possible and
are accepted: the check reads before it writes, and nothing between those two
steps prevents a second writer. *Rationale: every constraint that closes that
window also rejects a legitimately shared number, or requires a column marking
which numbers are shared. Chosen deliberately over both — see proposal.md.*

#### Scenarios

- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff attempts to create a new `cliente` with the same phone THEN the system MUST refuse that attempt and show a link to the existing customer's detail view
- GIVEN that refusal on screen WHEN staff confirms the number is shared THEN the system MUST save the new `cliente` with that same phone
- GIVEN that refusal on screen WHEN staff instead corrects the phone to an unused number THEN the system MUST save without asking for any confirmation
- GIVEN a `cliente` saved through the shared-number confirmation WHEN staff later edits that same customer and changes an unrelated field THEN the system MUST save without asking again
- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff edits that same customer's own record without changing the phone THEN the system MUST NOT flag it as a duplicate of itself
- GIVEN two different customers WHEN staff edits customer B's phone to match customer A's THEN the system MUST refuse that first attempt, and MUST accept it once staff confirms the number is shared

### Requirement: List View Search and Filter (R19)

The customer list view MUST provide a text search input matching `cliente` records by partial, case-insensitive AND accent-insensitive match against `name`, `phone`, or any of that customer's active vehicle `plate`s. Accent folding MUST apply to both the stored plate and the search term (`unaccent()` on both sides), exactly as it already does for `name`. The plate match MUST be evaluated as an existence check over the customer's vehicle collection — matching if any one active vehicle's plate matches — not a single-column comparison; a customer with zero vehicles MUST still match on `name` or `phone` alone. The same matching MUST also be reachable through `GET /api/customers`, gated by `customers.read`, accepting `search`, `page`, `pageSize`, and `status` parameters (`active` | `inactive` | `all`, defaulting to `active`; see R20). Each result MUST include a `plates: string[]` array of that customer's active vehicle plates (possibly empty) for disambiguation, replacing the single `vehiclePlate` field; a `cliente` with neither `phone` nor any plate on record MUST still render as an identifiable row, not a blank one. WHEN a search yields zero exact matches, the route MUST also return near matches produced from the same relaxed term — a shorter prefix for name/plate, and for `phone` the search TERM reduced to its last significant digits. The relaxation applies to the term only: the comparison still runs against the stored column verbatim, so this guarantee holds exactly as far as `normalizePhone` (`validation.ts`) has already stripped separators on write. A row written by any path that bypasses `normalizePhone` keeps its separators and is NOT covered. This is deliberately NOT fuzzy/similarity matching.

The list view MUST additionally let staff order results by clicking a whitelisted column header (`name`, `phone`, or `email`; see the `table-sorting` capability for the full whitelist, page-reset, invalid-parameter, and NULL-ordering rules that apply here). Sorting and search compose: a sort applies to whatever result set the current search and status filter already produced, never bypassing them. `GET /api/customers` (`handleListClientes`, consumed by `CustomerPicker`) remains deliberately unaffected by this addition — it does not accept a `sort` parameter, and its underlying `listClientes` order argument defaults to today's `desc(createdAt)` when omitted, so the picker's behavior is byte-identical to before.

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
- GIVEN two `cliente` records named "Juan Pérez" with the same phone but different plates, plus a third with `phone = ""` and zero vehicles WHEN `GET /api/customers?search=juan` is called THEN all three rows MUST be returned, the two Juans each carrying their own `plates` array, and the third rendering with a defined fallback label instead of blank fields
- GIVEN a `cliente` whose name only starts with "Juan" and another whose `phone` is stored as "+525512345678" (separator-free) WHEN searches for "Juan Alberto" and for "55 1234-5678" each yield zero exact matches THEN the system MUST return each `cliente` as a near match — by shorter prefix, and by reducing the search term to its last significant digits
- GIVEN an active search term matching several customers WHEN staff clicks the `name` header THEN the system MUST sort only the matching rows, MUST reset to page 1, and MUST leave the search term and status filter unchanged
- GIVEN a `status=inactive` filter active WHEN staff sorts by `phone` THEN the sort MUST apply only to the deactivated customers already matching that filter, never mixing in active customers

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

### Requirement: Customer Deactivation and Reactivation (R20)

Staff MUST be able to deactivate a `cliente` and to reactivate a deactivated
one. Both actions require `customers.write`; no separate grant is introduced.
Deactivation MUST be recorded as a nullable `deactivated_at` timestamp, never
a boolean, matching `vehiculo` and `users`.

Deactivation MUST NOT destroy or detach anything. Every `vehiculo`, every
`orden_servicio`, and every historical record belonging to that customer MUST
survive untouched, and reactivation MUST restore the customer to exactly the
state deactivation left, with no data re-entry.

A deactivated `cliente` MUST be excluded from the customer list and from the
service-order customer picker by default. The list MUST let staff choose
between three states — only active, only deactivated, or all — because a
two-state toggle cannot express "only deactivated", which is what someone
looking for a customer they retired is asking for. That exclusion MUST be applied in the
shared customer read path, not separately per screen. *Rationale: the picker
reads the same `GET /api/customers` the list does; filtering per caller leaves
every future caller to remember.*

Independently of that exclusion, the system MUST REFUSE to create a service
order whose `cliente` is deactivated, and MUST refuse it on the server rather
than only by hiding the customer from the picker. *Rationale: the exclusion is
a convenience and cannot be the guarantee. Staff A opens "Nueva orden" and
picks a customer, staff B deactivates them, staff A submits — a stale page is
enough to defeat any UI-only rule. The same requirement already applies to
editing a deactivated customer, and order creation already refuses a
soft-deleted `vehiculo`; this is the customer's missing half of that rule.*

A deactivated `cliente` MUST NOT receive reminders. The check MUST happen when
the reminder FIRES, not when it is scheduled, so a customer deactivated after
a reminder was queued still receives nothing. A reminder suppressed this way
MUST be recorded as `skipped`, NOT as `opted_out`. *Rationale: `opted_out`
records a consent decision the customer made per channel and carries legal
meaning; this is the workshop retiring a record. Conflating them corrupts the
one status that has to stay trustworthy.*

A deactivated `cliente` MUST NOT be editable while deactivated. Its detail
view MUST state the record is deactivated and MUST offer reactivation as the
way forward.

#### Scenarios

- GIVEN an active `cliente` WHEN staff deactivates it THEN the system MUST record `deactivated_at` and leave every vehicle and service order of that customer unchanged
- GIVEN a deactivated `cliente` WHEN staff reactivates it THEN the system MUST clear `deactivated_at` and the customer MUST reappear in the default list with its vehicles and history intact
- GIVEN a deactivated `cliente` WHEN staff searches for them in the service-order customer picker THEN the system MUST NOT offer that customer
- GIVEN a page opened while a `cliente` was still active WHEN staff submits a new service order for them after they have been deactivated THEN the system MUST refuse it on the server and create no order
- GIVEN a deactivated `cliente` WHEN staff asks the customer list to include deactivated records THEN the system MUST list that customer, marked as deactivated
- GIVEN both active and deactivated `cliente` records WHEN staff picks the deactivated-only state THEN the list MUST return every deactivated record and NO active one
- GIVEN the deactivated-only state matches nothing WHEN the list renders THEN it MUST say so and offer the way back to the active list, rather than claiming no customer is registered
- GIVEN a reminder already scheduled for a `cliente` WHEN that customer is deactivated before the reminder fires THEN `runReminder` MUST send nothing and MUST mark the reminder `skipped`
- GIVEN a reminder for a deactivated `cliente` WHEN it is suppressed THEN the system MUST NOT mark it `opted_out`
- GIVEN a deactivated `cliente` WHEN staff opens its detail view THEN the system MUST NOT offer the edit action and MUST offer reactivation

### Requirement: Customer Import from Interfuerza (R21)

Staff MUST be able to import customers from Interfuerza on demand, and to run
that import repeatedly without duplicating anyone. The action requires
`customers.write`.

Each imported `cliente` MUST be matched to its Interfuerza record by an
external identifier stored on the row, never by `phone` or `name`. *Rationale:
`phone` cannot identify a customer here — 9 numbers are shared by 18 people in
the live data, which is the reason R18 was rewritten. Matching by name would
merge two people who share one.*

A re-run MUST NOT overwrite state this application owns and Interfuerza does
not: the per-channel reminder opt-outs, the deactivation timestamp, and the
vehicle collection. *Rationale: a re-import that resurrects a customer the
workshop deactivated, or silently reverses a consent decision, is worse than
no import — it undoes deliberate work with no audit and no warning.*

A row the system cannot represent MUST be SKIPPED and REPORTED, never
fabricated and never silently dropped. At minimum a row with no name, no
external identifier, or no phone in any of its phone fields MUST be skipped,
and the result MUST name each skipped customer and the reason. *Rationale:
`phone` is `NOT NULL` and R17 requires it, so the alternatives were to invent a
value or to write rows this application's own form would reject. A skip that
nobody can see is indistinguishable from data loss.*

Phone values MUST be imported verbatim, without normalisation. *Rationale: the
owner was shown the consequence and chose it. The consequence recorded here
originally — that 353 of these customers therefore cannot receive a WhatsApp
reminder, and that changing it would be a data migration — was WRONG on both
counts, and is corrected here rather than left for the next change to believe.
E.164 is a wire format: `reminders/providers/whatsapp.ts` converts at the send
boundary, so an imported Panama MOBILE gets its reminder while the column keeps
the raw value the search and duplicate check read. A Panama LANDLINE still does
not, for a reason no storage format can fix — WhatsApp is a mobile service. The
storage decision stands on its own merits, not on that consequence.*

The import MUST be all-or-nothing. *Rationale: a half-imported customer list is
worse than an empty one, because staff cannot tell which half is missing.*

#### Scenarios

- GIVEN an Interfuerza customer not yet in this system WHEN staff runs the import THEN the system MUST create that `cliente` and record its external identifier
- GIVEN an already-imported customer WHEN staff runs the import a second time THEN the system MUST update that same record and MUST NOT create a second one
- GIVEN two Interfuerza customers sharing one phone number WHEN staff runs the import THEN the system MUST create both, matched by external identifier rather than conflated by phone
- GIVEN an imported customer the workshop has since deactivated WHEN staff runs the import again THEN that customer MUST remain deactivated
- GIVEN an imported customer whose WhatsApp opt-out was set locally WHEN staff runs the import again THEN that opt-out MUST survive
- GIVEN an Interfuerza row with no phone in any of its phone fields WHEN staff runs the import THEN the system MUST NOT create a `cliente` for it and MUST name it in the result with the reason
- GIVEN an Interfuerza row whose name is blank WHEN staff runs the import THEN the system MUST skip it rather than substituting any other field as the name
- GIVEN an 8-digit Interfuerza phone WHEN it is imported THEN the stored value MUST be that same string, with no country code added
- GIVEN a page of the import that fails after its retries are exhausted WHEN the run aborts THEN no customer from that run MUST remain persisted

### Requirement: Bulk Activate/Deactivate From the List

Staff MUST be able to select customers in the list view (per
`table-bulk-actions`) and apply Activar or Desactivar to the whole selection.
The bulk action MUST loop the existing per-row `deactivateCliente`/
`reactivateCliente` path (`PATCH /api/customers/[id]` with `{active}`)
sequentially, one row at a time — never a batched `UPDATE`. Applying
"Desactivar" to a selection that mixes already-deactivated rows MUST leave
those rows as a no-op success, not a reported failure; the mixed-state
ambiguity that requires two separate action buttons is specific to
`user-management`'s admin-floor rule and does not apply here.

#### Scenarios

- GIVEN 8 selected customers, all active
- WHEN staff runs "Desactivar"
- THEN the system MUST deactivate all 8 through 8 sequential calls to the existing per-row endpoint, and report 8 successes

- GIVEN a selection of 5 customers where 2 are already deactivated
- WHEN staff runs "Desactivar"
- THEN the system MUST report all 5 as applied, without listing the 2 as failures

- GIVEN a selection that includes a customer id since deleted by another session
- WHEN staff runs the bulk action
- THEN the system MUST apply it to every valid row and report the missing customer by id with a "no longer exists" reason, without failing the whole batch

### Requirement: Single Vehicle Insert Without Reconcile

The system MUST provide `POST /api/customers/[id]/vehicles` to add exactly one `vehiculo` to an existing, active `cliente`, gated by `customers.write`. This insert MUST NOT go through `planVehiculoReconcile` (the `PATCH /api/customers/[id]` vehicle-collection reconciler, which treats its payload's `vehicles` array as the customer's whole collection) and MUST NOT alter any other `vehiculo` row belonging to that customer, nor any `cliente` field, including `whatsappOptOut` and `emailOptOut`. The request payload MUST accept only plate, make, model, and year — no customer field of any kind. Validation MUST reuse the existing per-vehicle rule from the Field Validation requirement (plate required whenever any other vehicle field is set), not a second copy of it.

#### Scenario: Insert leaves the customer's other active vehicles untouched
- GIVEN a customer with 3 active vehicles
- WHEN staff inserts a 4th vehicle through this route
- THEN the customer MUST have 4 active vehicles, with the original 3 rows unchanged

#### Scenario: Insert leaves consent opt-outs untouched
- GIVEN that same insert
- WHEN it completes
- THEN `whatsappOptOut` and `emailOptOut` MUST be byte-identical to their pre-insert values

#### Scenario: Insert requires customers.write
- GIVEN a session without `customers.write`
- WHEN it calls this route
- THEN the system MUST reject it with 403 before any database work

#### Scenario: Plate required when any other vehicle field is set
- GIVEN a payload with `make` set and no `plate`
- WHEN it is submitted
- THEN the system MUST reject it, reusing the existing plate-required-with-any-other-field rule

#### Scenario: Deactivated customer cannot receive a new vehicle
- GIVEN a deactivated `cliente`
- WHEN staff attempts this insert against them
- THEN the system MUST refuse it, consistent with the existing rule against editing a deactivated customer
