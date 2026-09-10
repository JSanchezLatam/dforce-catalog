# customer-management Specification (delta)

## Delta Scope — and why nothing here is MODIFIED

WU3 changes how staff ENTER a vehicle's make and model. It changes nothing
about what is stored, what is required, or what is persisted. The shipped
baseline (`openspec/specs/customer-management/spec.md`) was read requirement by
requirement before this file was written, and each candidate was checked rather
than assumed:

- **Cliente Creation, Editing, Listing, and Detail View (R16)** names the
  vehicle fields as "make, model, year, plate — all optional as a group per
  vehicle". WU3 changes neither the field set nor their optionality; a make
  chosen from a select is the same nullable string a typed make was. Not
  modified.
- **Field Validation (R17)** requires `plate` whenever any other vehicle field
  is provided, evaluated per vehicle. A make selected from the catalog is
  "provided" on exactly the terms a typed make was, and a free-text "Otro" make
  likewise. The rule is untouched — including its wording, which never
  characterised make or model as free text. Not modified.
- **Vehicle Collection Persistence, Soft Delete, and Permanent Deletion** is
  about transactions, reconciliation and `deactivated_at`. WU3 adds no field to
  the payload and no branch to `planVehiculoReconcile`. Not modified.
- **Single Vehicle Insert Without Reconcile** pins the payload as "only plate,
  make, model, and year". WU3 sends exactly those four keys, with the same
  `trimmedOrUndefined` omission of blanks. Not modified.
- **List View Search and Filter (R19)** matches `name`, `phone` and active
  vehicle `plate`. Make and model are not searched today and are not searched
  by this change. Not modified.

So this delta is **ADDED only**. If a future reader believes one of the above
should have been a MODIFIED, the thing to check first is whether they are
reading a storage rule as an input rule — that is the mistake this section
exists to prevent.

The mechanics of the catalog, the selects, the "Otro" escape and the
never-blank rule live in the new `vehicle-catalog` capability. This file adds
only what is specific to the two customer-owned write paths.

## ADDED Requirements

### Requirement: Both Vehicle Write Paths Use One Shared Make/Model Control

The two paths that write a `vehiculo` — the order dialog's quick vehicle form
(`VehicleQuickForm`) and the customer form's vehicle collection
(`CustomerForm`) — MUST render the same make/model control, fed by the same
catalog module, rather than each screen assembling its own selects. Offering a
make on one path and not the other MUST NOT be possible by editing a single
screen.

The control MUST preserve the existing Spanish labels `Marca` and `Modelo` on
both paths, and MUST leave `plate` and `year` exactly as they are today —
including `year`'s existing coercion to a number before submission and the
validator's existing rule of keeping `year` only when it is already a number.
WU3 MUST NOT re-solve, refactor, or "tidy" that coercion.

Each path keeps its own field `id`s (the quick form's fixed ids and the
customer form's per-vehicle-row keyed ids), so a customer form showing several
vehicle cards still labels each card's make and model unambiguously.

#### Scenario: The order dialog offers the catalog
- GIVEN staff is creating a service order and opens the quick vehicle form for the chosen customer
- WHEN they open the "Marca" field
- THEN it MUST be the catalog select, with the same makes the customer form offers

#### Scenario: A customer with several vehicles labels each card's fields
- GIVEN a customer form showing three vehicle cards
- WHEN staff selects a make on the second card
- THEN only the second card's make MUST change, and the first and third cards' make and model MUST be unaffected

#### Scenario: The quick form still sends exactly four keys
- GIVEN staff adds a vehicle from the order dialog with a make and model chosen from the catalog
- WHEN the request is sent
- THEN its payload MUST carry only plate, make, model and year, with blank optional fields omitted rather than sent as empty strings

#### Scenario: Year behaviour is unchanged
- GIVEN staff enters a year alongside a catalog make and model
- WHEN the vehicle is saved
- THEN the year MUST be persisted exactly as it is today, as a number

### Requirement: Editing an Existing Vehicle Preserves Its Stored Make and Model

Opening an existing `cliente` for editing MUST seed each vehicle card's make
and model from the stored row and MUST NOT alter them as a side effect of
rendering. A stored make or model absent from the catalog MUST survive the form
being opened, another vehicle being edited, another field on the same vehicle
being edited, and the customer being saved.

Clearing the model in response to a make change MUST be triggered by staff
changing that make, never by the make arriving from stored data — an
implementation that reacts to the make VALUE rather than to the make CHANGE
would blank a legitimately stored model on the first render of every edit form,
which is the precise failure this requirement forbids.

#### Scenario: Opening an existing customer changes nothing
- GIVEN a `cliente` with two vehicles, one carrying a make the catalog does not list
- WHEN staff opens that customer for editing and saves without touching any vehicle
- THEN both vehicles' stored make and model MUST be unchanged, including the non-catalog one

#### Scenario: Editing one vehicle does not disturb a sibling's model
- GIVEN a `cliente` with two vehicles, both carrying a catalog make and model
- WHEN staff changes the first vehicle's make
- THEN the second vehicle's model MUST be untouched

#### Scenario: An edit to another field leaves make and model alone
- GIVEN a vehicle with a stored catalog make and model
- WHEN staff edits only its plate and saves
- THEN the saved make and model MUST be byte-identical to what was stored
