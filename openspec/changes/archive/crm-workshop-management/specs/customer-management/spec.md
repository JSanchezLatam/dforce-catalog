# Delta Spec: customer-management (crm-workshop-management)

## ADDED Requirements

### Cliente Creation, Editing, Listing, and Detail View (R16)

The system MUST allow staff to create a native `cliente` record with: name, phone, email (optional), and a single inline vehicle (make, model, year, plate — all optional as a group, see R17 for the plate exception). Staff MUST be able to edit any field of an existing `cliente`, including the inline vehicle. The system MUST provide a paginated list view of all `cliente` records and a detail view for a single record. The detail view MUST include that customer's service-order history (see `service-orders` capability), ordered most-recent first.

#### Scenarios

- GIVEN a staff user on the "New Customer" form WHEN they submit a valid name and phone THEN the system MUST create the `cliente` record and redirect to its detail view
- GIVEN an existing `cliente` WHEN staff edits its phone number and saves THEN the system MUST persist only the changed field, leaving name, email, and vehicle data untouched
- GIVEN more `cliente` records than fit on one page WHEN staff opens the customer list THEN the system MUST show a paginated table (same pagination pattern as inventory/catalogs) with at least name, phone, and vehicle plate columns
- GIVEN a `cliente` with one or more service orders WHEN staff opens its detail view THEN the system MUST display that customer's service-order history ordered most-recent first
- GIVEN a `cliente` with zero service orders WHEN staff opens its detail view THEN the system MUST show an empty-state message instead of an empty table with no explanation

### Field Validation (R17)

`name` and `phone` MUST be required on create and edit; `email` and the inline vehicle fields (make, model, year, plate) MUST be optional. IF any inline vehicle field other than `plate` is provided, THEN `plate` MUST also be provided — a vehicle without a plate is not a usable record for service-order lookups. `phone` MUST match a loose international format (optional leading `+`, 7–15 digits, spaces/dashes/parentheses allowed as separators only). `email`, when provided, MUST match a standard email format.

#### Scenarios

- GIVEN a form submission with an empty `name` WHEN staff submits THEN the system MUST reject it with a validation error identifying `name` as required
- GIVEN a form submission with an empty `phone` WHEN staff submits THEN the system MUST reject it with a validation error identifying `phone` as required
- GIVEN a form submission with `phone = "abc123"` WHEN staff submits THEN the system MUST reject it as an invalid phone format
- GIVEN a form submission with `email = "not-an-email"` WHEN staff submits THEN the system MUST reject it as an invalid email format
- GIVEN a form submission with no vehicle fields at all WHEN staff submits an otherwise-valid `cliente` THEN the system MUST accept it (vehicle is optional)
- GIVEN a form submission with `make = "Toyota"` and no `plate` WHEN staff submits THEN the system MUST reject it, requiring `plate` whenever any other vehicle field is present

### Duplicate Detection by Phone (R18)

`phone` MUST be unique across all `cliente` records. WHEN staff attempts to create a new `cliente` with a `phone` that already belongs to an existing record, THE system MUST block creation and present an error that links to the existing customer's detail view, so staff can update that record (e.g. add a note or correct data) instead of creating a fragmented duplicate. *Rationale: v1 supports a single inline vehicle per customer (see proposal), so a shared phone cannot yet represent two independent customer+vehicle records — blocking keeps service history consolidated under one `cliente` until multi-vehicle support exists.*

#### Scenarios

- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff attempts to create a new `cliente` with the same phone THEN the system MUST reject creation and show a link to the existing customer's detail view
- GIVEN an existing `cliente` with `phone = "+5215512345678"` WHEN staff edits that same customer's own record without changing the phone THEN the system MUST NOT flag it as a duplicate of itself
- GIVEN two different customers WHEN staff edits customer B's phone to match customer A's existing phone THEN the system MUST reject the edit as a duplicate

### List View Search and Filter (R19)

The customer list view MUST provide a text search input that matches `cliente` records by partial, case-insensitive match against `name`, `phone`, or vehicle `plate`.

#### Scenarios

- GIVEN a `cliente` named "Juan Pérez" WHEN staff types "juan" in the search box THEN the system MUST show that customer in the filtered list (case-insensitive, partial match)
- GIVEN a `cliente` with plate "ABC-123" WHEN staff types "abc" in the search box THEN the system MUST show that customer in the filtered results
- GIVEN a search term that matches no `cliente` WHEN staff submits it THEN the system MUST show an empty-results message rather than the full unfiltered list
- GIVEN staff clears the search box WHEN the input becomes empty THEN the system MUST show the full paginated customer list again
