# Tasks: enable and disable a customer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~380 `src/` |
| 400-line budget risk | Medium |
| Chained PRs recommended | No — one PR, chained off #68's branch |
| Delivery strategy | single PR targeting `feat/customer-shared-phones` |

Chained off `feat/customer-shared-phones` because that branch adds migration
`0016`; generating this one from `main` would produce a second `0016` and
collide on merge. Targets #68's branch, merges after it.

## WU1 — the column and the default exclusion

Files: `src/shared/db/schema.ts`, `migrations/0017_*.sql`, `queries.ts`(+test).

- [x] 1.1 `schema.ts` — `deactivatedAt` nullable timestamptz on `cliente` (D1).
- [x] 1.2 Generate migration `0017_*`, rename off drizzle-kit's random tag.
- [x] 1.3 RED `queries.test.ts` — `listClientes`/`countClientes` exclude deactivated rows by default and include them under `includeInactive` (D3).
- [x] 1.4 GREEN `queries.ts` — the filter, mirroring `activeVehiculoFilter()`'s shape and `listVehiculosByCliente`'s `includeInactive` option name.
- [x] 1.5 `getClienteById` is untouched, so it still returns a deactivated customer. **No unit test written on purpose**: it reads through the injected `queryFn` seam, so a unit test would assert against a fake and could not fail if a real filter were added. Covered in WU5 against real Postgres instead.

## WU2 — the two actions

Files: `service.ts`(+test), `api/customers/[id]/route.ts`(+test).

- [x] 2.1 RED `service.test.ts` — `deactivateCliente` sets a timestamp; `reactivateCliente` clears it; both use the injected-deps seam.
- [x] 2.2 GREEN `service.ts`.
- [x] 2.3 Unit: exactly one write, nothing else read. That the vehicles and orders SURVIVE is an e2e claim (5.1) — a unit test with an injected seam cannot prove a row it never wrote still exists.
- [x] 2.4 RED `route.test.ts` — both gated on `customers.write` (D2, no new action); 404 on an unknown id rather than a blind write.
- [x] 2.5 GREEN route.
- [x] 2.6 RED — a deactivated customer cannot be edited through PATCH (D5). Server-side, not only hidden in the UI.

## WU3 — reminders

Files: `src/modules/reminders/job.ts`(+test).

- [x] 3.1 RED `job.test.ts` — `runReminder` on a deactivated cliente sends nothing and marks `skipped`.
- [x] 3.2 RED — it marks `skipped`, NOT `opted_out` (D4). Asserted separately: collapsing the two corrupts the status that carries legal meaning.
- [x] 3.3 GREEN — one guard beside the existing cancelled-order check, at FIRE time.

## WU4 — the screens

Files: `CustomerFilters.tsx`(+test), `customers/page.tsx`, `customers/[id]/page.tsx`(+test), `CustomerFormTrigger.tsx`.

- [x] 4.1 RED/GREEN `CustomerFilters` — `?includeInactive=1` toggle, URL state, matching the debounced `router.push` idiom already there (D6).
- [x] 4.2 GREEN `customers/page.tsx` — read the flag, pass it through, mark deactivated rows.
- [x] 4.3 RED/GREEN `customers/[id]/page.tsx` — deactivated banner, "Reactivar" offered, "Editar" NOT offered (D5).
- [x] 4.4 GREEN — the deactivate action on an active customer's detail.

## WU5 — the real-SQL coverage

- [x] 5.1 e2e — the default exclusion through `GET /api/customers` against real Postgres, and the customer reappearing after reactivation. **This is the row that matters**: AGENTS.md's injected-seam limit means a green unit run proves ZERO coverage of the actual `WHERE`, and this whole change is a `WHERE`.
- [x] 5.2 e2e — the picker inherits the exclusion (same route, no picker change).
- [x] 5.3 Live smoke: apply `0017` against a real database, confirm every existing row reads as active.

## WU6 — the writing-down

- [x] 6.1 Delta spec: R16 restated IN FULL (the archiver replaces, it does not merge — the exact trap GGA caught on #68), plus new R20.
- [x] 6.2 `design.md` records why no new policy action and why `skipped` over `opted_out`.

## WU7 — what the e2e caught that every unit test missed

- [x] 7.1 **`includeInactive` was wired into the PAGE but not into the API
  route.** `normalizeClienteFilters` read it; `handleListClientes` did not, so
  "Ver desactivados" silently returned the active list. Every unit test was
  green: they inject `listClientes`, so nothing exercised the query-string
  parse. Exactly the AGENTS.md injected-seam limit, and exactly why 5.1 exists.
  Fixed, plus four route unit tests added for the parse itself — including one
  for the relaxed near-match pass, which rebuilds the filter object and would
  drop the flag one branch deeper.
- [x] 7.2 Lint went 15 → 23 warnings: eight `_id`/`_at` parameters added only
  to type a mock. Replaced with `vi.fn<SetDeactivatedAt>()`, which carries the
  signature without declaring parameters. Back at the documented baseline.

## Follow-ups (out of scope here)

- [ ] No hard delete for customers, and none planned. If one is ever wanted it needs its own change and its own administrador-only grant, on `customers.deleteVehicle`'s reasoning.
