# Delta Spec: customer-management (customer-status-filter)

Modifies `openspec/specs/customer-management/spec.md`.

## MODIFIED Requirements

**Restated in full, both of them.** The archiver REPLACES the matching
requirement rather than merging into it, so every surviving clause and scenario
has to be present here verbatim. Only R19's parameter list and R20's third
paragraph are new; everything else is the requirement exactly as it stands.

**Why two and not one**: R19 owns the route's parameter enumeration and R20
owns the exclusion RULE. `includeInactive` was a boolean living in both, and
replacing it in one and not the other is how this project has lost a decision
before — the acknowledgement archives while the other requirement goes on
demanding the old shape.

### Requirement: List View Search and Filter (R19)

The customer list view MUST provide a text search input matching `cliente` records by partial, case-insensitive AND accent-insensitive match against `name`, `phone`, or any of that customer's active vehicle `plate`s. Accent folding MUST apply to both the stored plate and the search term (`unaccent()` on both sides), exactly as it already does for `name`. The plate match MUST be evaluated as an existence check over the customer's vehicle collection — matching if any one active vehicle's plate matches — not a single-column comparison; a customer with zero vehicles MUST still match on `name` or `phone` alone. The same matching MUST also be reachable through `GET /api/customers`, gated by `customers.read`, accepting `search`, `page`, `pageSize`, and `status` parameters (`active` | `inactive` | `all`, defaulting to `active`; see R20). Each result MUST include a `plates: string[]` array of that customer's active vehicle plates (possibly empty) for disambiguation, replacing the single `vehiclePlate` field; a `cliente` with neither `phone` nor any plate on record MUST still render as an identifiable row, not a blank one. WHEN a search yields zero exact matches, the route MUST also return near matches produced from the same relaxed term — a shorter prefix for name/plate, and for `phone` the search TERM reduced to its last significant digits. The relaxation applies to the term only: the comparison still runs against the stored column verbatim, so this guarantee holds exactly as far as `normalizePhone` (`validation.ts`) has already stripped separators on write. A row written by any path that bypasses `normalizePhone` keeps its separators and is NOT covered. This is deliberately NOT fuzzy/similarity matching.

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
