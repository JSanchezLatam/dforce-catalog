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

Amended for the `phone` column's nullability only; every other clause of R17 —
the required/optional field set, the per-vehicle `plate` rule, and the phone and
email format rules — stands unchanged.

`cliente.phone` MUST be `NOT NULL` at the database level, matching the
already-required status R17 gives it in the application. *Rationale: R17 has
always rejected an empty `phone` (`validation.ts`, `"Phone is required"`) and
the column never agreed. A row with no phone cannot be found by the phone
search, cannot receive a WhatsApp reminder, and has no way to enter through any
current write path — so the nullable column was permitting only states nothing
produces.*

`NOT NULL` forbids a null, NOT an empty string. R19's guarantee that "a
`cliente` with neither `phone` nor any plate on record MUST still render as an
identifiable row" therefore STANDS UNCHANGED: "no phone on record" is now
spelled `''` instead of `NULL`, and every consumer already tests it by
truthiness (`schedule.ts:51`, `CustomerPicker.tsx:25`), not against null. No
defensive branch becomes dead, and no row shape stops rendering.

#### Scenarios

- GIVEN the `cliente` table WHEN a row is inserted with a null `phone` by any path THEN the database MUST reject it
- GIVEN a `cliente` whose `phone` is the empty string WHEN reminders are planned for it THEN the system MUST skip the WhatsApp channel exactly as it did for a null phone
