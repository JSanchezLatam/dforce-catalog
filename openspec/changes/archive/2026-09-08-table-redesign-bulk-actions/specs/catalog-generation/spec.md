# Delta for catalog-generation

## ADDED Requirements

### Requirement: Seeding the Builder From an Inventory Selection

Staff MUST be able to select products in the inventory list view (per
`table-bulk-actions`) and send that exact selection to the catalog builder,
opening it pre-populated with those products as a second, product-id-based
selection mode alongside the existing category-tree mode. The handoff MUST
carry only the selected product ids; the builder MUST resolve each id's
current product data itself rather than trusting data carried from the list
view, matching how the category-tree mode already resolves products
server-side.

There is deliberately no server-side "select all N matching the current
filter" — building a catalog from a selection larger than one inventory page
still requires ticking rows across each page. This is a known, accepted
limitation; the natural follow-up (a server-side "seleccionar los N que
coinciden con el filtro") is out of scope for this change.

#### Scenario: Selection opens the builder pre-populated
- GIVEN 15 products selected across 2 inventory pages
- WHEN staff sends the selection to the catalog builder
- THEN the builder MUST open with exactly those 15 products already selected, in its product-id selection mode

#### Scenario: Category-tree mode is unaffected
- GIVEN the builder's existing category-tree selection flow
- WHEN a user builds a catalog without ever visiting `/inventory`
- THEN that flow MUST behave exactly as it does today

#### Scenario: A stale id is dropped, not fabricated
- GIVEN a handed-off selection containing a product id since removed from inventory
- WHEN the builder resolves the selection
- THEN it MUST drop that id and proceed with the remaining valid products, rather than failing the whole handoff
