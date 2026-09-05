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
- [x] 1.3 **`inventory-sync/client.test.ts` and `job.test.ts` pass UNCHANGED** — 47/47, and `git diff` over those files is EMPTY. That is the assertion, not a claim.
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

- [ ] 3.1 `cliente.externalId` nullable text, migration `0018`.
- [ ] 3.2 RED/GREEN planner — external id present → update, absent → insert,
  no phone → skip.
- [ ] 3.3 RED — matching is on `externalId` ONLY. A test that two customers
  sharing a phone are not conflated, using the real 9-shared-by-18 shape.
- [ ] 3.4 RED — an update leaves `whatsappOptOut`, `emailOptOut`,
  `deactivatedAt` and the vehicle collection untouched (D3). **The one that
  keeps a re-run from resurrecting a deactivated customer.**

## WU4 — the run

Files: `customer-import/job.ts`(+test), route, a manual trigger.

- [ ] 4.1 One transaction: all or nothing (D6).
- [ ] 4.2 Result reports created / updated / skipped-with-reason.
- [ ] 4.3 Route gated on `customers.write`; the manual trigger mirrors
  `ManualSyncButton`.

## WU5 — the coverage the seam cannot give

- [ ] 5.1 e2e — run the import twice against real Postgres; the second run
  creates nothing and the row count is unchanged.
- [ ] 5.2 e2e — deactivate an imported customer, re-run, confirm
  `deactivatedAt` SURVIVES. Unit tests inject the DB seam, so the real `SET`
  list never executes under `npm test`.
- [ ] 5.3 e2e — a customer edited locally keeps their opt-out flags across a
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

## Known before starting

- [ ] **353 imported customers will not be able to receive a WhatsApp
  reminder**, because raw 8-digit Panama numbers are not E.164. The owner was
  shown this and chose raw. Fixing it later is a data migration over
  `cliente.phone`, not a code change.
- [ ] `Status` is uniformly `ACTIVE` across all 370, so nothing exercises a
  mapping onto `deactivatedAt` and none is written.
