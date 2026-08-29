# Delta for customer-management

## MODIFIED Requirements

### Requirement: List View Search and Filter (R19)

The customer list view MUST provide a text search input matching `cliente` records by partial, case-insensitive AND accent-insensitive match against `name`, `phone`, or vehicle `plate`. Accent folding MUST apply to both the stored value and the search term, so a term matches regardless of which side carries the diacritics. The same matching MUST also be reachable through `GET /api/customers`, gated by `customers.read`, accepting `search`, `page`, and `pageSize` parameters. Each result MUST include `vehiclePlate` for disambiguation; a `cliente` with neither `phone` nor `plate` on record MUST still render as an identifiable row, not a blank one. WHEN a search yields zero exact matches, the route MUST also return near matches produced from the same relaxed term — a shorter prefix for name/plate, and for `phone` the search TERM reduced to its last significant digits. The relaxation applies to the term only: the comparison still runs against the stored column verbatim, so this guarantee holds exactly as far as `normalizePhone` (`validation.ts`) has already stripped separators on write. A row written by any path that bypasses `normalizePhone` — a bulk import, for instance — keeps its separators and is NOT covered. This is deliberately NOT fuzzy/similarity matching.

(Previously: search existed only inside the list-view page, had no HTTP route, returned no plate, had no near-match fallback, and folded case only — `ilike` does not fold accents, so an accented `name` was unreachable from an unaccented term.)

#### Scenario: Search by name (unchanged)
- GIVEN a `cliente` named "Juan Pérez"
- WHEN staff types "juan" in the search box
- THEN the system MUST show that customer in the filtered list

#### Scenario: Search by plate (unchanged)
- GIVEN a `cliente` with plate "ABC-123"
- WHEN staff types "abc" in the search box
- THEN the system MUST show that customer in the filtered results

#### Scenario: Search an accented name without typing the accents
- GIVEN a `cliente` named "María GONZÁLEZ"
- WHEN staff types "maria gonza" — no accents, lower case — in the picker or the list-view search box
- THEN the system MUST show that customer as an exact match, and MUST NOT report zero matches or offer "create customer" as if none existed
- AND typing "maría gonzá", with the accents, MUST still match the same customer

#### Scenario: No matches in the list view (unchanged)
- GIVEN a search term that matches no `cliente`
- WHEN staff submits it on the list view
- THEN the system MUST show an empty-results message rather than the full unfiltered list

#### Scenario: Clearing the search (unchanged)
- GIVEN staff clears the search box
- WHEN the input becomes empty
- THEN the system MUST show the full paginated customer list again

#### Scenario: GET route requires customers.read
- GIVEN no `customers.read`
- WHEN calling `GET /api/customers?search=juan`
- THEN the system MUST reject with 403 before running any query

#### Scenario: GET route disambiguates by plate, tolerates missing data
- GIVEN two `cliente` records named "Juan Pérez" with the same phone but different plates, plus a third with `phone = null` and `vehiclePlate = null`
- WHEN `GET /api/customers?search=juan` is called
- THEN all three rows MUST be returned, the two Juans each carrying their own `vehiclePlate`, and the third rendering with a defined fallback label instead of blank fields

#### Scenario: Near match by relaxed term
- GIVEN a `cliente` whose name only starts with "Juan" (not "Juan Alberto") and another whose `phone` is stored as "+525512345678" — separator-free, which is what `normalizePhone` writes; a row still carrying "+52 55 1234 5678" is out of scope, since the relaxed term is matched against the column verbatim
- WHEN searches for "Juan Alberto" and for "55 1234-5678" each yield zero exact matches
- THEN the system MUST return each `cliente` as a near match — by shorter prefix, and by reducing the search term to its last significant digits
