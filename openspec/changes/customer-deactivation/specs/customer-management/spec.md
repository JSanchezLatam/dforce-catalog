# Delta Spec: customer-management (customer-deactivation)

Modifies `openspec/specs/customer-management/spec.md`.

## MODIFIED Requirements

### Requirement: Cliente Creation, Editing, Listing, and Detail View (R16)

**Restated in full.** The archiver REPLACES the matching requirement rather
than merging, so every surviving clause and scenario is reproduced here
verbatim. Only the list-scope sentence and the last two scenarios are new.

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

## ADDED Requirements

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
service-order customer picker by default, so that no new service order can be
opened against them. That exclusion MUST be applied in the shared customer
read path, not separately per screen. *Rationale: the picker reads the same
`GET /api/customers` the list does; filtering per caller leaves every future
caller to remember, and a deactivation that still admits new orders is
decorative.*

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
- GIVEN a deactivated `cliente` WHEN staff asks the customer list to include deactivated records THEN the system MUST list that customer, marked as deactivated
- GIVEN a reminder already scheduled for a `cliente` WHEN that customer is deactivated before the reminder fires THEN `runReminder` MUST send nothing and MUST mark the reminder `skipped`
- GIVEN a reminder for a deactivated `cliente` WHEN it is suppressed THEN the system MUST NOT mark it `opted_out`
- GIVEN a deactivated `cliente` WHEN staff opens its detail view THEN the system MUST NOT offer the edit action and MUST offer reactivation
