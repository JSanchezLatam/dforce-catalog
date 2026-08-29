# Delta for service-orders

## ADDED Requirements

### Requirement: Async Customer Selection in Order Creation

When creating or editing an `orden_servicio`, the customer picker MUST query customer search asynchronously (debounced, as staff types) instead of preloading the full customer list. A customer already selected on an order being edited MUST be resolved and rendered by id, even when it matches no current search term. WHEN a search yields zero exact matches, the picker MUST render near matches as the primary content, above any inline "create customer" affordance. The create affordance MUST appear only as a secondary action after the near matches, and MUST require `customers.write`; a user with only `customers.read` MUST see near matches with no create option.

#### Scenario: Picker queries instead of preloading
- GIVEN the service-order creation page loads
- WHEN it renders
- THEN the system MUST NOT preload any customer rows; a query MUST fire only once staff types a search term

#### Scenario: A preselected customer renders regardless of the search term
- GIVEN the picker is handed an already-resolved customer by its parent
- AND the current search term matches no rows, or matches rows that exclude that customer
- WHEN the picker renders
- THEN it MUST render that customer as its selected option, without issuing a query to find it

> Scope note — this is a **component-level guarantee, not a reachable end-to-end
> flow**. `ServiceOrderForm` renders the customer picker only under `!isEdit`, so
> editing an order does not display a picker that could be blanked. The guarantee
> is free: the parent is a server component that already loads the customer
> (`service-orders/[id]/page.tsx` calls `getClienteById(orden.clienteId)`), so the
> picker receives it as a prop and needs no lookup of its own. Specified so that
> whenever the edit path does grow a picker, it cannot silently drop the customer.
> Do NOT write an end-to-end test that opens an order for editing and expects a
> picker — nothing renders one today, and such a test would assert a fiction.

#### Scenario: Near matches before create, gated by customers.write
- GIVEN a search with zero exact matches but at least one near match
- WHEN the picker renders its empty state for a user with `customers.write`
- THEN the near matches MUST render first, and "create customer" MUST render only after them, never beside or above them

#### Scenario: Create affordance withheld without customers.write
- GIVEN the same zero-exact-match search, but a user with only `customers.read`
- WHEN the picker renders its empty state
- THEN the system MUST show the near matches with no "create customer" action

#### Scenario: Zero exact and zero near matches
- GIVEN a search term with no exact and no near matches
- WHEN the picker renders its empty state
- THEN the system MUST show an explicit no-matches message, followed by the create-customer affordance when `customers.write` is held
- AND a user without `customers.write` MUST still see that message, because rendering nothing is indistinguishable from a search that has not finished
