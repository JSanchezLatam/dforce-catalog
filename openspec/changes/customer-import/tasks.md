# Tasks: import customers from Interfuerza

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated production `src/` lines | ~450 |
| 400-line budget risk | High |
| Chained PRs recommended | No — **owner chose one PR** (2026-09-05) |
| Delivery strategy | single PR targeting `feat/customer-deactivation` |

`customer-deactivation` forecast ~380 and delivered 572 production lines
because eleven GGA rounds each added code. That is now the calibration point:
**assume review adds to a forecast rather than confirming it.**

WU1 is a behaviour-preserving refactor of a reviewed module, and the original
plan was to land it alone so a reviewer could tell which diff a regression came
from. **The owner chose one PR instead.** Recorded rather than silently
followed: the mitigation is that WU1 is its own commit and
`inventory-sync`'s tests are untouched in it, so `git diff` over that commit
still isolates the refactor.

## WU0 — the contract, already done

- [x] 0.1 Live sweep of all 370 rows before designing anything. `action:
  "customers"` confirmed; `clients`/`client` → 401, `contacts` → empty,
  `customer` → no list. Recorded in `proposal.md` and in Engram.
- [x] 0.2 Measured what decides the mapping: `Cliente` unique 370/370, `Token`
  empty on every row, `Nombre` never blank, `Status` uniformly ACTIVE, and the
  phone distribution that drove D4/D5.
- [x] 0.3 Probe scripts print AGGREGATES only — no name, phone, email or
  address of a real customer was written to a log.

## WU1 — extract the shared Interfuerza client

Files: `src/shared/interfuerza/client.ts`(new)(+test), `src/modules/inventory-sync/client.ts`.

- [x] 1.1 Move pagination, retry, `RATE_LIMIT_SPACING_MS` and `SyncAbortError`
  into `shared/interfuerza/client.ts`, parameterised by `action` and list key.
- [x] 1.2 `inventory-sync/client.ts` delegates, keeping its exact public API.
- [x] 1.3 **At the extraction commit**, `inventory-sync/client.test.ts` and
  `job.test.ts` passed UNCHANGED — 47/47, with an EMPTY `git diff`. That was
  the assertion the refactor rested on, and it held.
  **It no longer describes this PR.** WU2d added a `count` guard inside the
  shared transport, which those numeric-`count` fixtures structurally could not
  see, so `client.test.ts` now carries one post-extraction case and its diff is
  35 lines. `design.md` D1 was corrected in place and this line was left
  standing — two artifacts in one PR disagreeing about whether a file was
  touched, which is the class WU2c.2 was opened for.
- [x] 1.4 11 tests for the shared client's own contract, covering what only IT
  can be asked (the `action` and `listKey` parameters, which exist because
  there are two callers) plus the rules that carry the IP-ban risk. Pagination
  through the products path is NOT duplicated — `inventory-sync`'s untouched
  tests already own it.
  **Five mutations, all now failing by name**: hardcoding the action, ignoring
  `listKey`, ending pagination on page length instead of the `count`
  arithmetic, dropping the inter-page sleep, and treating a non-2xx response
  as an empty page (`clients` really does answer 401 on the live API — an
  empty page there would import nothing and report success).
- [x] 1.5 UNPLANNED, found by that mutation run: the page-length mutation
  originally **HUNG the worker for 32s** instead of failing, because the sleep
  test returned a full page forever and leaned on the very arithmetic being
  mutated to stop it. The hang masked the clean assertion in the test above it
  behind an "Errors 1" line. That fetch is now bounded. **A test must fail, not
  hang** — a hang names nothing.

## WU2 — the customers client and mapper

Files: `src/modules/customer-import/{client,mapper}.ts`(+tests).

- [x] 2.1 RED/GREEN client — `action: "customers"`, list key `customers`,
  pagination arithmetic against a `count` of 370.
- [x] 2.2 RED mapper — `Nombre` → `name`; `Telefono_1` then `Cellular` →
  `phone`, VERBATIM (D4); `Email` → `email` or null; `Cliente` → `externalId`.
- [x] 2.3 RED mapper — a row with no phone in any of the three fields yields a
  SKIP with a reason, not a row and not a throw (D5).
- [x] 2.4 RED mapper — `Token` is never read. A guard test, because it is named
  like an id and is empty on all 370 rows.
- [x] 2.5 RED mapper — `Contacto` is never used as a name fallback (D2); a row
  with a blank `Nombre` is a skip, not a silently-renamed customer.
- [x] 2.6 **Eight mutations, all failing by name.** Mapper: `Token` as the id,
  `Contacto` as a name fallback, normalising the phone to `+507`, preferring
  `Cellular` over `Telefono_1`, an empty-string email instead of `null`, and
  importing a phone-less row. Client: the `clients` action and the `contacts`
  list key — **the two that fail SILENTLY**, since a wrong action answers 401
  or an empty list and a wrong list key yields no rows, so the import finishes
  and reports success having imported nobody.
- [x] 2.7 The mapper NEVER throws. A row it cannot represent becomes a skip
  carrying a reason; a throw would abort an import of 370 customers over one
  bad row.

## WU3 — the column and the plan

Files: `src/shared/db/schema.ts`, `migrations/0018_*.sql`, `customer-import/plan.ts`(+test).

- [x] 3.1 `cliente.externalId` nullable text, migration `0018_cliente_external_id`.
  Not unique, guarded in `schema.test.ts` against all THREE ways Drizzle spells
  uniqueness — the hole C1 had to fix on `phone` at review round 1.
  **Verified against a real database, not just the schema**: the column is
  `text`, nullable, carries no unique index, and two rows with the SAME
  `external_id` insert cleanly.
- [x] 3.2 RED/GREEN planner — external id present → update, absent → insert,
  no phone → skip.
- [x] 3.3 RED — matching is on `externalId` ONLY. A test that two customers
  sharing a phone are not conflated, using the real 9-shared-by-18 shape.
- [x] 3.4 RED — an update leaves `whatsappOptOut`, `emailOptOut`,
  `deactivatedAt` and the vehicle collection untouched (D3). **The one that
  keeps a re-run from resurrecting a deactivated customer.**

## WU4 — the run

Files: `customer-import/job.ts`(+test), route, a manual trigger.

- [x] 4.1 One transaction: all or nothing (D6).
- [x] 4.2 Result reports created / updated / skipped-with-reason.
- [x] 4.3 Route gated on `customers.write`; the manual trigger mirrors
  `ManualSyncButton`.
  **This was marked complete when only the ROUTE half had tests** — five of
  them — and the trigger had none at all. Caught by GGA. That is the THIRD
  time on this branch a task was checked off with nothing behind half of it
  (`customer-deactivation` WU4.1 and WU4.4, `customer-import` WU2f.3 are the
  others), and the first two are written down in this same PR. The trigger now
  has 6 tests.

## WU5 — the coverage the seam cannot give

- [x] 5.1 e2e — run the import twice against real Postgres; the second run
  creates nothing and the row count is unchanged.
- [x] 5.2 e2e — deactivate an imported customer, re-run, confirm
  `deactivatedAt` SURVIVES. Unit tests inject the DB seam, so the real `SET`
  list never executes under `npm test`.
- [x] 5.3 e2e — a customer edited locally keeps their opt-out flags across a
  re-run.

## WU6 — the writing-down

- [x] 6.1 New requirement in the delta (R21), written BEFORE WU3 moves the shape. **Grep every requirement in the
  capability for the shapes this change touches** — `phone`, `cliente`
  identity — not only the one being added. That is the lesson C2 learned at
  round 10, when R19 was left affirming the opposite of the code.

## WU2b — GGA round 1 on C6 (three findings, all repo rules, two of them ours)

- [x] 2b.1 **I reproduced WU1.5's own lesson one commit after writing it.**
  `customer-import/client.test.ts` used an unbounded fetch mock — a full page
  forever, leaning on the `page * PAGE_SIZE >= count` arithmetic to terminate.
  Under a length-based rule that never stops. Bounded now.

  **And correcting my own verification, which was worse than the bug:** I first
  "confirmed the hang" with `timeout 45 npx vitest`, read the empty output as a
  hang, and reported it as measured. `timeout` does not exist on macOS — the
  command never ran. The finding was real; my evidence for it was not.
- [x] 2b.2 **That test does not prove the rule it looks like it proves**, found
  while re-verifying properly. 370 is 14 full pages plus a 20-row remainder, so
  BOTH termination rules stop at page 15 — with the rule mutated, the file
  still passes 4/4. The rule is proven in `shared/interfuerza/client.test.ts`
  against an exact multiple, the only shape where the two disagree. The comment
  now says that instead of claiming a failure it cannot produce.
- [x] 2b.3 `mapper.ts` read a THIRD phone fallback, `Telefono_2`, which design
  D4 does not name and which was measured empty on all 370 rows. No fixture
  could populate it and no mutation could prove it — a branch dead by
  measurement. Removed, and the test that said "three fields" no longer names
  a field the code does not consult.
- [x] 2b.4 `service-orders/service.test.ts` had `descripcion` where the type
  wants `description`. Fixed here; `rg descripcion src/` now returns zero.
  C2's tasks.md had filed it as "cosmetic, not fixed" — the wrong call, since
  the language rule splits by AUDIENCE and a test fixture key has no user
  audience. **That C2 entry is now corrected too**: left as an open `[ ]`, it
  described a defect that no longer exists, and two artifacts in one PR
  contradicting each other about a line that is not there is the same class as
  round 10's "R19 left affirming the opposite of the code".

## WU2c — GGA round 2 on C6

- [x] 2c.1 **A production infinite loop, in the file WU1 extracted.** `count`
  comes from `await response.json()`, so its `number` type is a CLAIM. The
  extraction hardened the list key and left `count` alone, and the two
  malformed shapes fail in OPPOSITE directions:
  `undefined` → `25 >= undefined` is false FOREVER, with no page cap and no
  retry ceiling (the budget only covers a page that FAILS, and every one of
  these succeeds) — hammering an API with a ~20 req/10s limit and a real
  1-hour ban; `null` → `25 >= null` is TRUE, because null coerces to 0, so it
  stops after page one, imports 25 of 370 and reports success.
  One guard covers both, aborting rather than breaking. `count: 0` still
  passes. **The irony is the finding**: WU1.5 recorded "a test must fail, not
  hang" about a fetch MOCK, and the production loop had the same shape and
  nobody looked.
- [x] 2c.2 Two artifacts in one PR contradicted each other about a line that
  does not exist — C2 filed `descripcion` as an open follow-up, C6 claimed it
  fixed. `rg descripcion src/` returns zero. Both corrected. Same class as
  round 10: an unchecked `[ ]` describing nothing real costs the next person
  twenty minutes hunting a typo that was never shipped.
- [x] 2c.3 The delta spec directory was empty while design and tasks existed.
  Written now rather than at WU6 — the capability-wide grep it owes is
  cheapest BEFORE `externalId` moves the shape, not after. The grep found
  nothing needing restatement, and says so explicitly: "nothing needed
  changing" and "nobody looked" are indistinguishable in an archive.

## WU2d — GGA round 3 on C6

- [x] 2d.1 **My round-2 fix broke the working products path, and I measured it
  rather than argued it.** The guard rejected anything not `typeof "number"`.
  A live call says `count` is a **STRING** on the wire — `"370"` for customers,
  `"699"` for products, both actions. So that guard would have aborted the
  weekly inventory sync, and the customer import, on page one of every run.
  The original comparison worked by COERCION (`25 >= "370"` is false), which
  is why nobody had noticed the type.
  Now `parseCount` accepts a number or a non-empty numeric string and rejects
  `undefined`, `null`, `""` and non-numeric text — the four shapes that either
  loop forever or truncate the run silently.
- [x] 2d.2 **The third mock-fidelity failure of this session, and the same
  root**: every fixture in every file handed back a numeric `count` that the
  API never sends. No test could see the guard reject reality. Fixtures now
  produce the wire shape by default.
- [x] 2d.3 **D1's proof expired and is corrected in place.** "Untouched tests
  prove the extraction" held for the extraction commit and stopped holding when
  a later commit changed behaviour underneath them.
  `inventory-sync/client.test.ts` now carries one post-extraction case for the
  wire shape and is deliberately no longer "untouched" — it stopped being able
  to earn the word. **An untouched test file is proof only while nothing
  underneath it changed.**
- [x] 2d.4 The shared abort message cited `R1.9`, an inventory-sync
  requirement, so a customer-import failure sent its reader into the wrong
  capability's spec. The shared string now names the action instead, and each
  caller's docstring owns its own citation.

## WU2e — GGA round 4 on C6

- [x] 2e.1 **My own WU2d.2 claim was false in the file that matters most.**
  It said "fixtures now produce the wire shape by default" — true in
  `shared/interfuerza/client.test.ts`, partly true in `inventory-sync`, and
  FALSE in `customer-import/client.test.ts`, the module whose entire job is
  fetching those 370 customers. Proven: restoring the strict `typeof` guard
  left all 4 of its tests green. Fixture fixed.
  Same class as C2 round 10 and C6 round 2 — an artifact affirming something
  the code does not do, and the claim is what makes it invisible.
- [x] 2e.2 Two different `R20`s cited three lines apart in
  `api/service-orders/route.ts`: `customer-management` R20 (deactivation) and
  `service-orders` R20 (order creation with parts). Both exist; the labels did
  not say which. **WU2d.4 had just removed `R1.9` from the shared abort message
  for exactly this reason and then I reintroduced the ambiguity here.** Both
  citations, and both test describes, now name their capability.
- [x] 2e.3 **The `pendingPushes` concern: investigated, mock made faithful, NO
  failing case found.** The mock notified every listener unconditionally, so a
  push that does not change the url was indistinguishable from one that does —
  the fourth mock-fidelity gap of this shape. Fixed: an unchanged url now
  notifies nobody, as the real router does not.
  With that in place the leak still could not be demonstrated. The next
  navigation decrements the stray count to zero and releases the ref anyway,
  so the skew is transient. The one-line guard stays as precision, its comment
  says exactly that, and **the test that could not distinguish it was deleted
  rather than kept as a placebo** — passing with and without the fix is the
  signature this branch has been catching all session.

## WU2f — GGA round 5 on C6 (three findings, all mine, all one class)

- [x] 2f.1 `tasks.md` 1.3 still claimed an EMPTY diff over
  `inventory-sync/client.test.ts`. It is 35 lines. D1 retracted the claim in
  place; this line did not.
- [x] 2f.2 `design.md`'s Testing-strategy table repeated the same expired claim
  — BELOW the paragraph that withdraws it. A reader reaching the table first is
  told the opposite of what the file just corrected.
- [x] 2f.3 **Task 2.7 was checked with no test behind it.** Every case in
  `mapper.test.ts` went through `row()`, which always spreads a well-formed
  object, so nothing ever reached the `(raw ?? {})` guard or `text()`'s
  `typeof` check. The guard was real; the claim it was PROVEN was not.
  Seven cases now: `null`, `undefined`, a string, a number, an array, an empty
  object, and a row with right names and wrong types. Mutation-verified by
  removing the `?? {}`. This matters more than usual here — the mapper's whole
  contract is "never abort over one bad row", and the import is all-or-nothing,
  so one throw takes all 370 down.
  **Same as C2's WU4.1**: "marked complete in an earlier commit with NO test
  written". Second time on this branch.
- [x] 2f.4 `InterfuerzaAbortError.name` was still `"SyncAbortError"`. WU2d.4
  removed `R1.9` from the abort MESSAGE so a customer-import failure stops
  citing inventory-sync's spec; the `name` did the same thing in every log line
  and stack trace. Nothing reads it — both callers use `instanceof` — so it now
  matches the class.

## Outcome so far

**GGA PASSED on round 6** (WU1 + WU2). Five failed rounds before it. What they
caught, none of it style:

- a production **infinite loop** on a malformed `count`, in the file WU1 had
  just extracted
- my fix for THAT, which required `typeof "number"` and would have aborted the
  weekly inventory sync and this import on page one of every run — because
  `count` is a **string** on the wire, measured live
- an unbounded fetch mock that HUNG instead of failing, reproducing WU1.5's own
  lesson one commit after writing it
- a task marked complete with no test behind it (the second time on this
  branch)
- three artifacts affirming things the code did not do

Two nits from the passing round were fixed after it, with gates re-run:
`PageResult` typed `count` as `number` while the file itself proved it a
string, and the no-search "Ver desactivados" link dropped `pageSize` one branch
over from where WU14.2 fixed exactly that. Both mutation-verified.

## Still to do — the feature is NOT complete

WU3 (the `externalId` column and the insert/update/skip planner), WU4 (the
transactional run and its route), and WU5 (the e2e that proves a re-run does
not resurrect a deactivated customer) are unwritten. This slice is the
transport and the mapping only: **nothing imports anything yet.**

## WU3 — delivered by two parallel agents, verified independently

Split by disjoint file ownership: one agent took `schema.ts` + the migration +
fixtures, the other took the new pure `plan.ts`. Neither touched the other's
files.

**Their reports were not taken at face value.** Re-run here:
- Leaking `deactivatedAt` or `whatsappOptOut` into the update patch → **red**,
  on the exact-key assertion (`Object.keys(patch).sort()`, not
  `toMatchObject`, which would pass with an extra field present).
- All three Drizzle uniqueness shapes on `externalId` → **red**.
- Migration `0018` applied to a real database: column `text`, nullable, no
  unique index, and two rows sharing an `external_id` insert cleanly.

- [ ] **A real coverage gap the schema agent found and reported honestly**:
  every `cliente` fixture in the suite goes through `as unknown as Cliente`,
  which bypasses missing-property checks — so adding a column to `cliente` is
  NOT type-checked anywhere in the tests. `tsc` was clean before and after
  `externalId`, which is exactly the problem. Pre-existing and repo-wide, so
  it needs its own change; recorded rather than widened into this one.

## WU4 + WU5 — two agents in parallel over a contract I fixed first

They are NOT naturally independent: WU5's e2e tests the job WU4 writes. Split
by writing the exported signature of `runCustomerImport` into BOTH prompts
verbatim, so each worked one side of it. The e2e agent was told explicitly not
to stub the job and not to weaken an assertion to make its file run — it wrote
what it could, said plainly what was waiting, and I ran the suite after both
landed.

**Verified here, not taken from their reports:**
- `npm test` 1215/1215, tsc clean, lint at the baseline.
- **e2e 43/43 TWICE on clean databases** (39 before this work unit), 0 rows
  left behind either time. A single green run is not the standard in this repo.
- **The mutation that matters**: making the re-import's `UPDATE` carry
  `deactivatedAt: null` and `whatsappOptOut: false` turns TWO e2e rows red by
  name — *"does not resurrect a customer deactivated locally after a re-run"*
  and *"does not reverse a locally-set whatsapp opt-out after a re-run"*.
  **No unit test in this repo can prove that**: every one injects the DB seam,
  so the real `UPDATE` never runs under `npm test`.
- Route: neutralising the `customers.write` gate, and deleting the
  `InterfuerzaAbortError → 502` mapping, each turn a test red.

- [ ] **Not proven, and it cannot be here**: the transactional rollback itself
  is `db.transaction()`'s guarantee, and an injected fake cannot demonstrate
  it. `inventory-sync/job.test.ts` documents the same limit.
- [ ] **Scope the WU4 agent reported rather than hid**: adding the manual
  trigger broke 14 pre-existing tests two ways — `route-guards.test.ts` has a
  completeness check that requires every route be registered, and
  `customers/page.test.tsx` crashed because the button calls `useToast()`
  outside a provider. Fixed by registering the route and stubbing the button
  the way `CustomerFormTrigger` already is. Outside the four files it was
  given, and necessary to leave the suite green.

## WU4b — GGA round 1 on the full change (six findings, four of them repeats)

The repeats are the point. Four classes this branch had already caught, named,
and written into these very files came back in new code.

- [x] 4b.1 **`CustomerImportButton` had no `catch`** — `fetch` REJECTS on a
  network failure rather than returning a non-ok response, so the button
  re-enabled with nothing on screen and the operator clicked into the same
  silence. **Verbatim the defect `customer-deactivation` WU8.3 records fixing
  in `CustomerActivationButton`** — whose test file already contains
  *"shows an error when fetch itself rejects"*. The new component was written
  without reading it.
- [x] 4b.2 **It shipped with ZERO tests while task 4.3 was checked.** See 4.3
  above. Six tests now; removing the `catch` turns two red by name.
- [x] 4b.3 **English error text rendered to Spanish-speaking staff.** The route
  passed `err.message` through and the button rendered it verbatim — so on the
  one failure path that fires in production, the workshop read
  *"aborting, prior DB state preserved"*. The English detail is now
  `console.error`'d, where it belongs, and the operator gets Rioplatense
  Spanish. Mutation-verified.
- [x] 4b.4 A test named *"when no deps are given"* that passed all three deps.
  Renamed to what it proves, with an honest note that the `??` defaults are
  covered only by the e2e. **Third time this branch fixed a false test name.**
- [x] 4b.5 **The skip report was collapsed to a count.** D5 says the skip path
  exists so "the result lists them by name and external id so the owner can add
  the real number" — and the UI showed "9 omitidos" with no surface naming
  which nine. The names now render. Same shape as `customer-deactivation`
  WU11.2 and WU13.3, both fixed on this branch for the same reason.
- [x] 4b.6 **The whole import ran inside one open transaction, inside a
  synchronous HTTP handler.** All 15 page fetches held a Postgres connection
  idle-in-transaction; one flaky page meant **120 seconds** of retry
  `setTimeout` with that connection still held. D6's all-or-nothing guarantee
  never required the fetch to be inside — mapping is fully materialised before
  the writes. The fetch is now drained first and the transaction covers only
  `listExisting`, the plan, and the writes.
  Mutation-verified by putting the fetch back inside: *"never opens the
  transaction at all when a later page aborts"* goes red.

**A correction of my own verification**: I first reported the English-error
mutation as "not caught". It never applied — my pattern was single-line and the
code spans several. Same class as the `timeout` incident earlier on this branch.
Re-run properly, it goes red.

## WU4c — GGA round 2 (two findings, both the same family)

- [x] 4c.1 **Three different Spanish strings for one failure, none matching.**
  The component rendered `"No se pudo importar a los clientes."`, the test's
  mock body invented `"No se pudo importar los clientes."` (no `a`), and the
  ROUTE actually returns `"No se pudo completar la importación…"`. The non-ok
  test therefore rendered a string its own mock had made up — it would pass
  whatever the route said — and the `catch` test asserted a PREFIX that matched
  all three.
  **"A mock more convenient than reality" for the fourth time on this branch.**
  Fixtures now carry the route's real body, every assertion pins the exact
  string, and `route.test.ts` pins the route literal instead of a loose regex.
  Before this, no test anywhere fixed the text the operator actually reads on
  the import failure path.
- [x] 4c.2 `job.test.ts`'s `fakeTx()` recorded `id: "unknown"` because it could
  not read the id out of `eq(cliente.id, id)` — so the assertion would have
  passed identically had the job updated the WRONG row. The comment claimed the
  id was "threaded in by the caller below", which no call did: a comment
  asserting what the code does not do, for the fourth time in this PR.
  Fixed properly rather than by correcting the comment: the fake now extracts
  the id from the SQL fragment via drizzle's `Param`, so the assertion means
  what it looks like. **Verified by pointing `job.ts` at a different customer —
  the test goes red**, which it could not have done before.

## WU4d — GGA round 3: the most serious defect in C6

- [x] 4d.1 **No concurrency guard — two clicks would have created 740 customers
  instead of 370.** Postgres is READ COMMITTED, so a second transaction's
  `listExisting` cannot see the first's uncommitted inserts; both plan INSERT
  for the same external ids and both commit. `external_id` deliberately carries
  no unique index (D2), so nothing downstream catches it. The run is ~7.5s on
  the happy path and up to 120s per retried page, so the window is ordinary.
  **`inventory-sync` already solved this** — `syncRuns` exists precisely because
  "an already-in-progress response needs its own source of truth" — and this
  module copied its transaction while dropping its guard.

  Fixed in two layers, kept explicitly distinct in the code:
  - **Layer 1, best-effort**: `customer_import_runs` (migration `0019`) read
    before the fetch, so a second click does not burn ~15 more Interfuerza
    requests against an API with a documented 1-hour ban. Documented in the
    module docstring AND inline as TOCTOU — **not** the correctness mechanism.
  - **Layer 2, the guarantee**: `pg_advisory_xact_lock` as the FIRST statement
    of the write transaction, before `listExisting`. A second run blocks there,
    then reads committed rows and plans UPDATEs.

  7 mutations, all red by name — including one that only MOVES the lock after
  `listExisting`, which is what separates "the lock exists" from "the lock is
  where it has to be".

  **Proven against real Postgres, twice over.** By hand first: two psql
  connections, the second waited exactly the 3 seconds the first had left to
  hold. Then made permanent, because a one-time manual check rots — an e2e row
  races two `runCustomerImport` calls with `Promise.all` and asserts ONE row
  survives. Layer 1 is deliberately bypassed in it, with a comment saying why:
  a test that let layer 1 reject the second run would prove layer 1 and say
  nothing about layer 2. **No sleeps, no timing assumptions.** Removing the
  lock turns it red — verified independently here, not taken from the report.
- [x] 4d.2 **The skip list told the operator something false.** Every skipped
  row rendered under `"Omitidos por falta de teléfono:"` while `mapCustomerRow`
  emits THREE reasons. A customer skipped for a blank `Nombre` appeared there —
  and since the mapper sets `name: null` on that path, as a bare external id
  under a heading that was wrong about why it was on screen. R21 requires the
  reason, and it stopped at the JSON.
  Each row now carries its own reason, and the heading is neutral.
- [x] 4d.3 **The type widening that hid 4d.2**, and the placebo it created. The
  component redeclared the skip type with `reason: string` instead of importing
  the closed union, so nothing pointed at the heading — and every fixture fed
  `missing_phone`, making the copy untestable by construction. Fifth time this
  PR caught that class.
  Now `Record<SkipReason, string>`, which is the structural fix: **a fourth
  reason added to the mapper becomes a compile error** until someone writes its
  copy. `import type` is erased at build, so no database code reaches the client
  bundle.

## Known before starting

- [ ] **353 imported customers will not be able to receive a WhatsApp
  reminder**, because raw 8-digit Panama numbers are not E.164. The owner was
  shown this and chose raw. Fixing it later is a data migration over
  `cliente.phone`, not a code change.
- [ ] `Status` is uniformly `ACTIVE` across all 370, so nothing exercises a
  mapping onto `deactivatedAt` and none is written.
