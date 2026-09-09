# Delta for customer-management

## ADDED Requirements

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

## Verification Notes

- This insert is a new real-SQL write path. Per AGENTS.md's injected-seam limit, a green unit suite proves zero coverage of it — this change was itself born from that exact blind spot (`POST /api/service-orders` shipped unable to save because Drizzle received a string where a `Date` was declared, and every unit test supplied its own typed input so the suite never sent what a browser sends). An **e2e row against a real Postgres**, with a customer holding 3+ active vehicles, is required verification here, not optional — a single-vehicle customer cannot expose the `planVehiculoReconcile` full-collection-overwrite trap at all.
- Only 2 of 370 customers in the dev database currently have a vehicle; exercising the "other vehicles stay untouched" scenario needs a seeded customer with 3+ active vehicles first.
