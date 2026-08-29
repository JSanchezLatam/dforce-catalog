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
- **Accent-insensitive matching.** Postgres `ilike` folds case but not accents (`'María GONZÁLEZ' ilike '%maria%'` is `f`, verified on PG 17.10), and the dataset is Spanish. Staff typing `maria gonzalez` got zero exact matches, zero near matches, and then the create button — this change's own anti-duplicate mechanism handing them the duplicate, on the most common input shape in the data. `buildClienteSearchWhere` now wraps both column and pattern in `unaccent()`; migration `0012` enables the extension.

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

Reuse `buildClienteSearchWhere` (pure, tested, ORs a match over name/phone/plate) through the existing paginated `listClientes`. Do not write a second search implementation. The one edit it does take is the accent fold below — made *inside* that predicate precisely so there stays exactly one definition of "search". Mirror `api/users/route.ts` for the route shape (`can()` before any work, injectable deps) and `CustomerFilters.tsx` for the debounced input. `ClienteListItem` already carries `vehiclePlate`; `ServiceOrderCustomerOption` widens to include it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/customers/route.ts` | Modified | Add `handleListClientes` + `GET` |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modified | Async picker; option type gains plate |
| `src/app/(app)/service-orders/page.tsx` | Modified | Drop customer preload + its half of `PICKER_LIST_LIMIT` |
| `src/modules/customers/queries.ts` | Modified | `buildClienteSearchWhere` folds accents: `unaccent(col) ilike unaccent(pattern)` on all three columns |
| `src/shared/db/migrations/0012_enable_unaccent.sql` | Added | `CREATE EXTENSION IF NOT EXISTS unaccent` (trusted on PG 13+, no superuser) |
| `src/app/(app)/customers/page.tsx` | **Behaviour changed, code unchanged** | Shares `buildClienteSearchWhere`, so its list search becomes accent-insensitive too — see Risks |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Create affordance still races ahead of matches | Med | Spec it as an ordering requirement with its own scenario |
| Leading-wildcard `ilike` ignores the btree indexes, and `unaccent()` puts an index further out of reach still | Low | 364 rows, sequential scan is correct; see design.md "Migration / Rollout" before any `pg_trgm` work |
| The customers list page's search changes too, though we said we would not touch it | Med | Stated, not hidden: `buildClienteSearchWhere` is shared with `customers/page.tsx`, so its search also stops missing accented rows. Consistent and an improvement — but a real behaviour change to a page listed as unchanged, and the reason the rollback is no longer two independent reverts |
| Editing an order whose customer is off the first page | Med | Preselected customer resolved by id, not by search results |
| Regressing the plate-less customer to an unlabelled row | Med | Explicit fallback scenario |

## Rollback Plan

Three reverts, and only two of them are independent. The picker commit restores the `listClientes` preload and the old `<Select>`; the route commit deletes the `GET` export. Neither touches `queries.ts`, so neither affects the customers list page.

The accent-fold commit is the exception, and this section originally claimed otherwise. `queries.ts` **is** modified now, so reverting that commit also reverts the customers list page's search back to accent-sensitive. It is still a clean, standalone `git revert` — the predicate is one function and the migration is additive — but it is not blast-radius-free, and it must be reverted on its own rather than as a side effect of rolling back the picker or the route.

Reverting the code does not need the migration reverted: `CREATE EXTENSION IF NOT EXISTS unaccent` is additive and unused once the predicate stops calling it. Drop the extension only as a deliberate separate step.

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
