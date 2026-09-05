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

## WU10 — GGA round 3 on C2 (four findings, all real)

Three of the four were in the e2e file, against conventions that file writes
down about itself.

- [x] 10.1 **The new e2e describe had no `afterAll`.** Every neighbouring
  describe has one, and `customer search` spells out why: without it the block
  is a one-way write against whatever database ran the suite. Worse here —
  `reactivateCliente` only runs in the LAST test, so any earlier failure would
  have left "Retirado Perez" permanently deactivated. Added; verified
  empirically by querying the throwaway database after a run (0 rows left).
- [x] 10.2 `beforeAll` shells out to `drizzle-kit migrate` and closed with
  `});` while every other one in the file closes `}, 60_000);`. A flake waiting
  for the first slow box.
- [x] 10.3 The new describe had been inserted BETWEEN the C3 docstring and the
  `vehicle search` describe it documents, orphaning it. Block moved below
  `vehicle search`.
- [x] 10.4 **A non-atomic PATCH.** `{ active: true, name: "" }` reactivated the
  customer and THEN answered 400 for the invalid name — the operator saw a
  rejection while the record went live. The mirror case wrote nothing, because
  deactivation ran last: same request shape, opposite outcome on failure.
  The ordering comment argued the order was load-bearing, and it was — but
  only when everything succeeded. **Fixed by rejecting the combination**, which
  removes the hazard AND the ordering it existed to serve: no UI sends both,
  since D5 hides "Editar" while deactivated and the activation button sends
  `active` alone. The route is shorter than before.
- [x] 10.5 `buildPageHref` still read `search`/`pageSize` with
  `typeof === "string"` while `normalizeClienteFilters` used `firstValue()`, so
  `?search=a&search=b` filtered by "a" and paged with no search at all. 9.3
  claimed the function was swept and it was not — only the one key was.

## WU11 — GGA round 4 on C2

- [x] 11.1 **BLOCKING, and the THIRD instance of the same failure class** (after
  8.1 and 10.5): a filter surviving one layer and not the next. Here it is a
  RACE rather than a missing line. `applyFilter` read `searchParams` from the
  closure of the render that created it, and `applyDebounced` schedules that
  closure 300ms out — so a push landing inside the window was overwritten by
  the stale snapshot. Proven with a probe:
  `["/customers?includeInactive=1", "/customers?search=perez"]`. The operator
  ticks the box and watches it come back unticked.
  The mechanism is PRE-EXISTING (`pageSize` was always exposed to it); what
  this change adds is a third filter falling into it, in the one feature whose
  entire value is that filter surviving. Fixed at the read: `applyFilter` now
  reads `window.location.search`, which is current by definition. A ref
  refreshed each render was the first attempt and is NOT enough — it still
  depends on the previous `router.push`'s re-render landing before the timeout,
  which is the same race one step smaller.
  The test file's `push` mock now actually navigates; without that no test here
  could observe a stale-read bug at all, since every push left the URL
  unchanged. Mutation-verified.
- [x] 11.2 The empty state said "Todavía no hay clientes registrados." when
  every customer was deactivated — a false claim, and the one place this change
  let a retired record be silently invisible. Now names the state and links to
  "Ver desactivados".
- [x] 11.3 Two comments asserted "the repo's 43 alerts". Measured: main 43,
  this branch 46 — stale the moment the diff lands. The count is dropped; the
  reasoning stands without it.

## WU12 — GGA round 5 on C2 (my own round-4 fix was wrong)

- [x] 12.1 **WU11.1 narrowed the race; it did not close it, and the comment I
  shipped claimed otherwise.** It said `window.location.search` is "current by
  definition". Verified against the installed Next **16.2.11** and it is false:
  `router.push` only dispatches into the React action queue, and
  `window.history.pushState` runs from a `useEffect` keyed on `appRouterState`
  (`next/dist/client/components/app-router.js:64,70`). On a server-component
  page the URL therefore lands only after the RSC payload arrives — so the fix
  traded a 300ms race against a re-render for a 300ms race against a network
  round trip, over a list query this repo documents as a sequential scan.
  Now a ref written at PUSH time: `applyFilter` is the only writer of this
  component's query string, so what it last pushed is authoritative the instant
  it pushes it. The `useEffect` reset covers external navigation (back button,
  `<Link>`), which is not racing a debounce the user just started.
- [x] 12.2 **My test could not have caught 12.1**, and this is the part worth
  remembering: the `push` mock called `replaceState` SYNCHRONOUSLY, which is
  more synchronous than the real router. It manufactured the property under
  test. The mock now navigates late, and the race test sets the delay LONGER
  than the debounce — the case that separates a correct fix from one that
  merely narrows the window. Verified against all three versions: the original
  closure read, the `window.location`-only read, and the ref. **Only the ref
  passes.** With the fast mock, the `window.location` version passed too, which
  is exactly how it shipped.
- [x] 12.3 The async mock leaked a pending navigation into the NEXT test and
  rewrote its URL. Handles are tracked and cleared in `afterEach`.
- [x] 12.4 **Deactivating an already-deactivated customer restamped the date.**
  Two staff on one record — A deactivates, B's stale page still shows
  "Desactivar", B clicks — and D1's "since when?" was gone. Fixed with
  `coalesce` inside the UPDATE rather than a read-then-write: one statement has
  no window between check and write, and `returning()` still distinguishes
  "no such row". Only real SQL can prove it, so the test is an e2e row —
  mutation-verified.

## WU13 — GGA round 6 on C2

- [x] 13.1 **"Limpiar" was a SECOND writer, and the fifth occurrence of one
  failure class in this change.** `applyFilter`'s docstring claimed it was
  "the ONLY writer of this component's query string" while the button pushed
  on its own forty lines below — updating neither `pushedParamsRef` nor the
  pending debounce. Two live failures: clear the filter and the next keystroke
  rebuilt from the stale ref and brought it back; and a debounce armed before
  the clear fired afterwards and re-pushed the very term just cleared. Neither
  needs an exotic window — "clear, then search again" is the ordinary rhythm.

  **The lesson is the one this change kept re-learning: an invariant asserted
  in a comment is not an invariant.** `applyFilter`, `clearFilters` and the
  debounce now all funnel through one `commit()`, and there is exactly ONE
  `router.push` in the file — a second writer is now something you would have
  to add a second push to create.

  `clearFilters` cancels the pending debounce and `applyFilter` deliberately
  does not: typing "perez" then ticking the box must keep both, while clearing
  must not be undone by a timer.
- [x] 13.2 "Limpiar" left the typed term visible in the box, because the input
  is uncontrolled — so the screen disagreed with the list it had just
  produced, and made 13.1's race look like the input "just didn't take".
  Cleared imperatively through a ref rather than by remounting on a `key`,
  which would steal focus mid-typing.
- [x] 13.3 **A searched deactivated customer was still silently invisible** —
  the exact rule WU11.2 wrote down, one branch over. Searching a name is how
  staff reach ONE customer, far more than opening a bare list; the screen said
  they did not match and offered only a link that clears the search. Now
  "Ningún cliente activo coincide… Buscar también entre los desactivados",
  preserving the term.
- [x] 13.4 `ClienteFilters.includeInactive` now documents that `undefined` and
  `false` are deliberately equivalent, and that the page and the API route
  legitimately send different shapes — the per-caller divergence that produced
  7.1 and 10.5.

## WU14 — GGA round 7 on C2

- [x] 14.1 **`createOrder` refused a soft-deleted VEHICLE and not a
  soft-deleted CUSTOMER.** `getClienteById` deliberately returns deactivated
  customers, and the only check was `!clienteDetail` — so
  `POST /api/service-orders` accepted a retired customer, with the picker's
  exclusion as the sole defence. That is exactly what D5 and task 2.6 rule out
  for edits ("server-side, not only hidden in the UI") and it was never applied
  here. The stale-page scenario is the same one WU12.4's `coalesce` exists for:
  A opens "Nueva orden" and picks Juan, B deactivates Juan, A submits — and the
  order's reminders then log `skipped` for a customer only visible behind
  `?includeInactive=1`.
  Guarded beside the existing vehicle check, reusing `ClienteDeactivatedError`
  and mapped to 409 like the customers route. **The delta spec was
  strengthened too**: R20 framed the refusal as a CONSEQUENCE of the picker
  exclusion, which is a UI-only guarantee; it now requires the server refusal
  in its own sentence, with its own scenario.
- [x] 14.2 The "Buscar también entre los desactivados" link dropped `pageSize`.
  It now goes through `buildPageHref`, so it cannot drift from the pagination
  links beside it.

## WU15 — GGA round 8 on C2

- [x] 15.1 **The route now answers 409 for TWO reasons and the form only knew
  one.** WU14 added `cliente_deactivated`, whose body carries no
  `existingClienteId` — so `setSharedPhoneWith(undefined)` armed nothing, the
  block stayed hidden, `errors` had been cleared at the top of `submit()`, and
  the dialog sat there saying nothing. **A path this change created.** And it
  is precisely the one D5 exists for: hiding "Editar" removes the FRESH path
  and does nothing for the stale one, which is the only one the 409 catches.
  Branched on `body.error`; mutation-verified.
- [x] 15.2 **A second placebo test of mine.** "records the deactivated skip as
  skipped, NOT as opted_out" used `whatsappOptOut: false`, which makes
  `markOptedOut()` unreachable no matter where the guard sits — moving the
  guard BELOW the opt-out check left all 22 tests green. `not.toBe()` on a
  value the code cannot produce is a placebo. Now `whatsappOptOut: TRUE`, so
  the two reasons actually compete and deactivation has to win; the same
  mutation now goes red.
- [x] 15.3 `ClienteDeactivatedError → 409` on the service-orders route had no
  test. Its twin on the customers route did. Added, mutation-verified.
- [x] 15.4 A genuinely empty database offered "Ver desactivados" — a link to
  another empty page — while "Todavía no hay clientes registrados" became
  reachable only WITH `includeInactive=1`, the one case where it is least
  true. The offer is now gated on a second count that runs ONLY when the
  active list came back empty, so it costs nothing in the normal case.
- [x] 15.5 Import ordering in two files put `@/modules/customers/service` above
  `vitest` and between the two `@/modules/auth/*` imports.

## WU16 — GGA round 9 on C2

- [x] 16.1 **The ref invariant still had a hole with TWO pushes outstanding.**
  `useSearchParams()` reflects the COMMITTED url, so push A landing nulled the
  ref holding push B, and the next debounce rebuilt from `window.location` —
  which still showed A. The checkbox came back unticked. Sixth occurrence of
  one class in this change, and the repo already documents that this list's
  RSC round trip is slower than the 300ms debounce, so it is the normal shape.
  Fixed with a pending-push counter: only the LAST of our own pushes releases
  the ref, while an external navigation arrives with the counter at zero.
- [x] 16.2 **The test could not express the bug, and that is the finding worth
  keeping.** `useSearchParams` was mocked as a frozen object, so the
  component's `useEffect([searchParams])` NEVER fired — every question about
  what happens when a navigation commits was unaskable. Written the first time,
  the two-push test passed against the broken code. The mock now commits like
  Next does: URL first, then notify every consumer of the hook, forcing the
  re-render. Only then did the defect appear; mutation-verified afterwards.
  **This is the third mock-fidelity failure in this change** (a `push` that did
  not navigate, a `push` that navigated synchronously, and now a hook that
  never updated). Each one hid a real defect behind a green test.
- [x] 16.3 The `hasDeactivated` comment claimed the second count "costs nothing
  in the normal case". It runs on every empty result, which on this screen
  includes every mistyped search. The comment now states the real cost and why
  it is acceptable, rather than a claim that flatters it.

## WU17 — GGA round 10 on C2

- [x] 17.1 **R19 was left affirming the opposite of the code, in the MAIN
  spec.** `spec.md:63` still demanded a `phone = null` row that migration
  `0016` makes unconstructible.

  The sharp part: **the C1 delta already knew.** Its R17 rationale says R19
  "STANDS UNCHANGED" because "no phone on record" is now spelled `''` — but
  that sentence lives inside R17, and **the archiver replaces R17 without ever
  touching R19**. The acknowledgement would have been archived while the stale
  scenario stayed. Code, e2e and fixtures all got this right; only the spec was
  left behind, one requirement over from the one being edited.

  R19 is now restated in full in BOTH deltas: `customer-shared-phones` changes
  the scenario's data shape, `customer-deactivation` adds `includeInactive` to
  the route's parameter enumeration, which R20 states the rule for but does not
  list. C2 archives after C1 and carries both edits, so branch order is also
  archive order — noted in the delta itself.

  **The reusable lesson: full-restatement discipline follows the DATA SHAPE,
  not only the requirement you are editing.** Before archiving, grep every
  requirement in the capability for the old shape.
- [x] 17.2 The Vehículos docstring said restore "happens from Editar" without
  noting that D5 removes "Editar" for a deactivated customer, making vehicle
  restore unreachable until reactivation. That is intended; the comment now
  says so rather than leaving it to be rediscovered as a bug.

## Known and NOT fixed here

- [ ] The service-order detail page links a customer's name with no deactivated
  marker. R20 does not require it and adding it means threading `deactivatedAt`
  through the service-orders read path — a decision, recorded here rather than
  taken silently at the end of a review round.

- [ ] The empty state renders on `items.length === 0` while `hasDeactivated`
  gates on `total === 0`. Past the last page of a search that DOES match, the
  screen says "Ningún cliente coincide con la búsqueda" — wrong, and
  pre-existing. The new offer correctly stays hidden there; fixing the message
  is its own change.

- [ ] **The "Ver desactivados" checkbox is controlled by a server prop**, so it
  stays visually unticked for a full RSC round trip over a query documented as
  a sequential scan. Same pattern as the `pageSize` select, so it is at least
  consistent — but it is the one control this whole feature hangs on. Making it
  optimistic means holding client state that can disagree with the URL, which
  is the class of bug this change spent five rounds on; it deserves its own
  change rather than a late addition to this one.

- [ ] **`gga run --pr-mode` ignored `PR_BASE_BRANCH` as an environment
  variable.** All four rounds reviewed `main...HEAD`, i.e. C1 AND C2 together,
  despite `PR_BASE_BRANCH=feat/customer-shared-phones` being exported.
  AGENTS.md says to "pin `PR_BASE_BRANCH` per-branch when it matters" without
  saying it only takes effect from `.gga`, which is committed and shared and
  therefore cannot hold a branch name. Not harmful here — it surfaced a real C1
  regression in round 2 — but the guidance is incomplete and belongs in its own
  change.

## Follow-ups (out of scope here)

- [ ] No hard delete for customers, and none planned. If one is ever wanted it needs its own change and its own administrador-only grant, on `customers.deleteVehicle`'s reasoning.
