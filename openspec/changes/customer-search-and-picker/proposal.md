# Proposal: Scalable Customer Search and Picker

## Intent

Staff create duplicate customers because the picker makes finding harder than creating. A census of the real Interfuerza dataset (364 customers) found 9 shared phone numbers across 18 customers; 6 pairs have identical names — genuine duplicates. Every pair was created weeks or months apart, so these are search failures, not concurrency races.

Today `service-orders/page.tsx` pre-loads `PICKER_LIST_LIMIT = 1000` customers into a plain `<Select>` and filters client-side, because the customers API has no `GET` at all (`api/customers/route.ts` is POST-only). This change is the root-cause fix.

## Scope

### In Scope
- `GET /api/customers` — session + `customers.read` guarded, `search`/`page`/`pageSize` params, backed by the existing `listClientes`/`countClientes`.
- Switch the service-order customer picker to query that route asynchronously (debounced), dropping the 1000-row preload.
- Each result row shows the vehicle plate as disambiguator, with a defined no-plate fallback.
- Empty-state ordering: near matches first, inline "create customer" only as a secondary action revealed after them.

### Out of Scope
- Duplicate-phone race fix and `phone NOT NULL` (a UNIQUE phone index is ruled out — shared phones are legitimate).
- Enable/disable customers; vehicles one-to-many; service history categories; Interfuerza customer sync.
- The parts picker in `ServiceOrderForm`, which shares the same 1000-row ceiling. Known sibling, fixed separately.

## Capabilities

Note: `openspec/specs/` holds only `catalog-generation`, `template-config`, `workshop-settings`. The `customer-management` and `service-orders` baselines were never merged out of `openspec/changes/archive/crm-workshop-management/specs/`; read them there.

### New Capabilities
- None.

### Modified Capabilities
- `customer-management`: R19 search gains a server-side HTTP surface; picker rows carry the plate disambiguator.
- `service-orders`: order creation selects a customer by async search instead of a bounded preloaded list.

## Approach

Reuse `buildClienteSearchWhere` (pure, tested, already ORs `ilike` over name/phone/plate) through the existing paginated `listClientes`. Do not write a second search implementation. Mirror `api/users/route.ts` for the route shape (`can()` before any work, injectable deps) and `CustomerFilters.tsx` for the debounced input. `ClienteListItem` already carries `vehiclePlate`; `ServiceOrderCustomerOption` widens to include it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/customers/route.ts` | Modified | Add `handleListClientes` + `GET` |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modified | Async picker; option type gains plate |
| `src/app/(app)/service-orders/page.tsx` | Modified | Drop customer preload + its half of `PICKER_LIST_LIMIT` |
| `src/modules/customers/queries.ts` | Unchanged | Reused as-is |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Create affordance still races ahead of matches | Med | Spec it as an ordering requirement with its own scenario |
| Leading-wildcard `ilike` ignores the btree indexes | Low | 364 rows; revisit with a trigram index only if measured |
| Editing an order whose customer is off the first page | Med | Preselected customer resolved by id, not by search results |
| Regressing the plate-less customer to an unlabelled row | Med | Explicit fallback scenario |

## Rollback Plan

Two independent reverts: the picker commit restores the `listClientes` preload and the old `<Select>`; the route commit deletes the `GET` export. `queries.ts` is untouched, so neither revert can affect the customers list page.

## Dependencies

- None. Ships before the Interfuerza customer sync, which will multiply the row count this fixes.

## Review Budget

Estimate ~250–350 changed lines including tests — comfortably inside the 800-line budget. Single PR, no chaining.

## Success Criteria

- [ ] The service-order page loads no customer rows; the picker fetches on typing.
- [ ] A customer is findable by partial name, phone, or plate through the route.
- [ ] Two same-name customers are distinguishable in the picker; a plate-less one still renders identifiably.
- [ ] With zero exact matches, near matches render before the create action, never beside it.
- [ ] `customers.read` is denied before any query runs.
