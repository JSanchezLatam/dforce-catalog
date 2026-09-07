# Delta Spec: customer-management (customer-shared-phones)

Modifies `openspec/specs/customer-management/spec.md`.

## MODIFIED Requirements

### Requirement: Duplicate Detection by Phone (R18)

R18 is rewritten. Its old first sentence — "`phone` MUST be unique across all
`cliente` records" — is **withdrawn**, and with it the guarantee that creation
is blocked. Read the replacement below in full; nothing of the old wording
survives.

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

### Requirement: Field Validation (R17)

**Restated in full.** The archiver REPLACES the matching requirement in the
main spec with this block — it does not merge — so every surviving clause and
every surviving scenario has to be present here verbatim. Only the last
sentence of the paragraph and the last two scenarios are new; everything else
is R17 exactly as it stands today.

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

### Requirement: List View Search and Filter (R19)

**Restated in full, and the reason is worth stating plainly.** This delta's R17
rationale ALREADY said R19 stands unchanged because "no phone on record" is now
spelled `''` instead of `NULL` — but that sentence lives inside R17, and the
archiver replaces R17 without ever touching R19. The acknowledgement would have
been archived while R19's own scenario went on demanding a `phone = null` row
that migration `0016` makes unconstructible: the main spec asserting the
opposite of the code, which is the failure this project has already shipped
twice.

Nothing here changes except that one scenario's `phone = null` → `phone = ""`.
The guarantee is identical — a customer with neither phone nor plate still
renders as an identifiable row — only its spelling moved.

*Full-restatement discipline follows the DATA SHAPE, not only the requirement
being edited. Before archiving, grep every requirement in the capability for
the old shape.*

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
- GIVEN two `cliente` records named "Juan Pérez" with the same phone but different plates, plus a third with `phone = ""` and zero vehicles WHEN `GET /api/customers?search=juan` is called THEN all three rows MUST be returned, the two Juans each carrying their own `plates` array, and the third rendering with a defined fallback label instead of blank fields
- GIVEN a `cliente` whose name only starts with "Juan" and another whose `phone` is stored as "+525512345678" (separator-free) WHEN searches for "Juan Alberto" and for "55 1234-5678" each yield zero exact matches THEN the system MUST return each `cliente` as a near match — by shorter prefix, and by reducing the search term to its last significant digits
