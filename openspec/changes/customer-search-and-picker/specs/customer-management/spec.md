# Delta for customer-management

## MODIFIED Requirements

### Requirement: List View Search and Filter (R19)

The customer list view MUST provide a text search input matching `cliente` records by partial, case-insensitive match against `name`, `phone`, or vehicle `plate`. The same matching MUST also be reachable through `GET /api/customers`, gated by `customers.read`, accepting `search`, `page`, and `pageSize` parameters. Each result MUST include `vehiclePlate` for disambiguation; a `cliente` with neither `phone` nor `plate` on record MUST still render as an identifiable row, not a blank one. WHEN a search yields zero exact matches, the route MUST also return near matches produced from the same relaxed term — a shorter prefix for name/plate, and a digits-only comparison for `phone` that ignores formatting and country-code differences. This is deliberately NOT fuzzy/similarity matching.

(Previously: search existed only inside the list-view page, had no HTTP route, returned no plate, and had no near-match fallback.)

#### Scenario: Search by name (unchanged)
- GIVEN a `cliente` named "Juan Pérez"
- WHEN staff types "juan" in the search box
- THEN the system MUST show that customer in the filtered list

#### Scenario: Search by plate (unchanged)
- GIVEN a `cliente` with plate "ABC-123"
- WHEN staff types "abc" in the search box
- THEN the system MUST show that customer in the filtered results

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
- GIVEN a `cliente` whose name only starts with "Juan" (not "Juan Alberto") and another whose `phone` is "+52 55 1234 5678"
- WHEN searches for "Juan Alberto" and for "5512345678" each yield zero exact matches
- THEN the system MUST return each `cliente` as a near match — by shorter prefix, and by digits-only phone comparison
