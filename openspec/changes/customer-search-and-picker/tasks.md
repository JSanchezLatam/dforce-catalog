# Tasks: Scalable Customer Search and Picker

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300–380 (design.md, proposal.md) |
| Session review budget | 800 (session override; skill default 400 not applicable) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `GET /api/customers` + `relaxSearchTerm` | PR 1 | `npm test -- route.test near-match.test` | `npm run test:e2e` (customer search describe, real Postgres) | Delete `GET`/`handleListClientes` export; `near-match.ts` |
| 2 | `CustomerPicker` component | PR 1 | `npm test -- CustomerPicker.test` | N/A — jsdom + mocked `fetch` only, no real backend behaviour to prove | Delete `CustomerPicker.tsx`/`.test.tsx` |
| 3 | Wire picker into `ServiceOrderForm`/page | PR 1 | `npm test -- ServiceOrderForm` | N/A — wiring only, covered by unit 1/2 harnesses | Revert to `<Select>` + preload (git revert this commit) |

## Phase 0: Branch

- [x] 0.1 Branch `feat/customer-search-and-picker` off `chore/preview-clean-output` (carries `0ad05a0`), not `main`.

## Phase 1: Near-match pure module

- [x] 1.1 RED — `src/modules/customers/near-match.test.ts`: digits-only terms relax to the same key (`2345678`, `234-5678`, `+507 234-5678`); short terms return `null`; a name/plate term relaxes to a shorter prefix.
- [x] 1.2 GREEN — `src/modules/customers/near-match.ts`: implement `relaxSearchTerm(term): string | null` per design.md's rules.

## Phase 2: `GET /api/customers`

- [x] 2.1 RED — `route.test.ts`: unrecognised `x-user-role` → 403, and the `listClientes`/`countClientes` spies were never called (mirrors `handleListUsers`, `route.test.ts:18-24` shape).
- [x] 2.2 RED — `route.test.ts`: throws with no session headers (same shape as the existing POST test).
- [x] 2.3 RED — `route.test.ts`: `search`/`page`/`pageSize` parsing+clamping; `relaxedFrom` set only when the primary query returns zero rows; second query suppressed when `relaxSearchTerm` returns `null`.
- [x] 2.4 GREEN — `src/app/api/customers/route.ts`: add `handleListClientes(request, deps)` + `GET`, `can(user, "customers.read")` before body/deps touched, injectable `listClientes`/`countClientes`, calls `relaxSearchTerm` on zero rows.

## Phase 3: Real-SQL proof (required, not optional)

- [x] 3.1 Add `customer search (E2E)` describe to `src/e2e/full-flow.e2e.test.ts`: seed 4 `cliente` rows (mixed-case name, null plate, null phone, formatted phone); call the real `GET` handler for partial lowercase name, partial plate, digits-only phone, and a relaxed-only term. Run with `npm run test:e2e` against a throwaway Postgres.

## Phase 4: `CustomerPicker` component

- [ ] 4.1 RED — `CustomerPicker.test.tsx`: one `fetch` per debounced typing burst (jsdom + mocked `fetch` + fake timers).
- [ ] 4.2 RED — `CustomerPicker.test.tsx`: a `selectedCustomer` prop renders as selected even when a later search excludes it.
- [ ] 4.3 RED — `CustomerPicker.test.tsx`: zero exact matches → near matches render before "create customer", never beside it (highest-risk behaviour, proposal.md).
- [ ] 4.4 RED — `CustomerPicker.test.tsx`: create action absent when `canCreateCustomer` is false.
- [ ] 4.5 RED — `CustomerPicker.test.tsx`: zero exact and zero near matches → only the create affordance renders.
- [ ] 4.6 GREEN — `src/modules/service-orders/CustomerPicker.tsx`: debounced `fetch` (300 ms, `CustomerFilters.tsx`'s `debounceRef` idiom, no `router.push`); row takes `plates: string[]`; identifier precedence plates → phone → email → "Registrado el {createdAt}"; ordered empty state gated by `canCreateCustomer`.

## Phase 5: Wire into the order form

- [ ] 5.1 `ServiceOrderForm.tsx`: widen `ServiceOrderCustomerOption` (line 23) to `ClienteListItem`'s shape; accept `selectedCustomer`/`canCreateCustomer` props; replace the `<Select>` block (lines 174–195) with `CustomerPicker`; drop the `customers` array prop.
- [ ] 5.2 `ServiceOrderFormTrigger.tsx`: drop `customers` prop, forward `selectedCustomer`/`canCreateCustomer`.
- [ ] 5.3 `service-orders/page.tsx`: drop the `listClientes` preload (line 69) and its `Promise.all` slot; pass `canCreateCustomer={can(user, "customers.write")}` to the trigger; rewrite the `PICKER_LIST_LIMIT` comment (lines 28–32) — it now bounds the parts picker only, a customer search route exists.

## Phase 6: Delivery

- [ ] 6.1 Run full suite + `npm run test:e2e`; confirm ≥833 passing (baseline) plus new tests, 0 regressions.
- [ ] 6.2 `tsc` exit 0; lint 0 errors, ≤15 pre-existing warnings (no new ones).
- [ ] 6.3 Manual GGA review pass (four layers) before opening the PR.
- [ ] 6.4 Open PR against `chore/preview-clean-output`; note the two independent revert boundaries (route commit, picker commit) from proposal.md's Rollback Plan.
