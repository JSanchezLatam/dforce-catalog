# Delta Spec: customer-management (service-order-reception)

A customer MAY carry one identity document ("Cédula / RUC"), recorded as free text. Panamanian cédulas and RUCs vary in shape and relatives share documents, so the field is neither validated by format nor unique.

## MODIFIED Requirements

### Requirement: Field Validation (R17)

`name` and `phone` MUST be required on create and edit; `email` MUST be optional, and a `cliente` MAY have zero vehicles. For each `vehiculo` record attached to a `cliente`, IF any field other than `plate` (make, model, year) is provided, THEN `plate` MUST also be provided for that same vehicle — a vehicle without a plate is not a usable record for service-order lookups. This rule MUST be evaluated independently per vehicle, never across the customer's whole collection. `phone` MUST match a loose international format (optional leading `+`, 7–15 digits, spaces/dashes/parentheses allowed as separators only). `email`, when provided, MUST match a standard email format. `cliente.phone` MUST additionally be `NOT NULL` at the database level, matching the required status this requirement already gives it in the application. `documento_identidad` ("Cédula / RUC") MUST be optional free text: trimmed of surrounding whitespace, stored as null when empty after trimming, capped at 30 characters, with no format check and no uniqueness constraint at any level.
(Previously: no identity document field existed.)

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
- GIVEN a submission with no `documento_identidad` WHEN staff submits an otherwise-valid `cliente` THEN the system MUST accept it and store null
- GIVEN `documento_identidad = "  8-123-456  "` WHEN staff submits THEN the system MUST store `"8-123-456"`
- GIVEN `documento_identidad` of 31 characters WHEN staff submits THEN the system MUST reject it with a Spanish validation error; with exactly 30 characters it MUST accept it
- GIVEN a `cliente` already holding `documento_identidad = "8-123-456"` WHEN staff saves a second `cliente` with the same value THEN the system MUST accept it
- GIVEN a customer import run WHEN it updates an existing `cliente` THEN `documento_identidad` MUST be left unchanged
