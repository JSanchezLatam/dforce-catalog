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

- [x] 4.1 `CustomerFilters` — `?includeInactive=1` toggle, URL state. **This task was marked complete in an earlier commit with NO test written** — GGA caught the false claim. `CustomerFilters.test.tsx` now exists: 6 tests over the pushed URL, including that unticking REMOVES the key rather than setting `0`, and that the toggle returns to page 1.
- [x] 4.2 GREEN `customers/page.tsx` — read the flag, pass it through, mark deactivated rows.
- [x] 4.3 RED/GREEN `customers/[id]/page.tsx` — deactivated banner, "Reactivar" offered, "Editar" NOT offered (D5).
- [x] 4.4 `CustomerActivationButton` — likewise claimed complete with only `page.test.tsx` asserting which LABEL renders. `CustomerActivationButton.test.tsx` now covers the payload shape, `router.refresh()` on success, both failure paths, and that the button re-enables so the action can be retried.

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

## WU8 — GGA round 1 on C2 (three findings, all real)

- [x] 8.1 **LIVE BUG — `buildPageHref` dropped `includeInactive`.** Turn on
  "Ver desactivados", page to 2, and the flag vanished: the list silently
  narrowed to active-only, which reads as the records having disappeared
  rather than the filter having reset. **The same failure class as WU7, one
  function over** — a flag wired into one layer and not the next. Fixed, and
  `src/app/(app)/customers/page.test.tsx` now exists (the file GGA noted was
  missing entirely); the pagination test is mutation-verified by removing the
  line again.
- [x] 8.2 **The route's 404 test asserted the mock, not the route.** Verified:
  I replaced `setActivation`'s throw with a silent `return undefined` and all
  17 route tests still passed, because the test hand-feeds the rejection.
  Renamed to what it actually proves — the error-to-status MAPPING, which IS
  the route's job. The "does not write blind" claim belongs to
  `service.test.ts`, where an injected `setDeactivatedAt` makes it real.
- [x] 8.3 `CustomerActivationButton` had no `catch`. `fetch` REJECTS on a
  network failure rather than returning a non-ok response, so the button
  re-enabled with nothing on screen and staff clicked into the same silence.
  Fixed and mutation-verified.
- [x] 8.4 The "Desactivado" chip used `CHIP`, the class that marks neutral
  metadata (make, model, year) — a retired customer read with the same weight
  as "Toyota". Now a destructive-tinted badge.

## WU9 — GGA round 2 on C2 (two defects, both proven with probes)

- [x] 9.1 **A regression C1 introduced and this diff surfaced.** The list cell
  read `item.phone ?? "—"`, and `??` is NULLISH. Migration `0016` made `phone`
  NOT NULL, so "no phone on record" became `""` — which sails past the
  fallback, rendering a blank cell while Email and Vehículos both showed an em
  dash. Fixed to `||`, mutation-verified. **`customer-shared-phones/design.md`
  D4 claimed this class was swept and enumerated the consumers; it missed this
  one.** That claim is now corrected in place, with the complete sweep, rather
  than left standing in an archive.
- [x] 9.2 **A malformed `active` answered 200 having written nothing.** The
  branches were `true`, `undefined`, `false`; anything else fell through all
  three. Proven with a probe: `{ active: "false" }` returned `200` with body
  `{}` and zero calls to update/deactivate/reactivate. The button reads
  `response.ok`, refreshes, and the operator watches the state not change with
  nothing on screen — the same silence WU8's `catch` exists to prevent, one
  layer up. Now a 400, rejected rather than coerced, matching
  `confirmsSharedPhone`'s strict `=== true` in the same module.
- [x] 9.3 `buildPageHref` read `params.includeInactive` directly while
  `normalizeClienteFilters` used `firstValue()`. Now both use the helper —
  WU8's bug one input shape over.
- [x] 9.4 The deactivated banner was `role="alert"`; it is server-rendered and
  present on load, not a change being announced. `role="status"`.

## Follow-ups (out of scope here)

- [ ] No hard delete for customers, and none planned. If one is ever wanted it needs its own change and its own administrador-only grant, on `customers.deleteVehicle`'s reasoning.
