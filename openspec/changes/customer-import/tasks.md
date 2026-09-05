# Tasks: import customers from Interfuerza

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated production `src/` lines | ~450 |
| 400-line budget risk | High |
| Chained PRs recommended | **Yes — WU1 separately** |
| Delivery strategy | WU1 (refactor) as its own PR, then the feature |

`customer-deactivation` forecast ~380 and delivered 572 production lines
because eleven GGA rounds each added code. That is now the calibration point:
**assume review adds to a forecast rather than confirming it.**

WU1 is a behaviour-preserving refactor of a reviewed module and is worth
landing alone — mixed into the feature, a reviewer cannot tell which diff a
regression came from.

## WU0 — the contract, already done

- [x] 0.1 Live sweep of all 370 rows before designing anything. `action:
  "customers"` confirmed; `clients`/`client` → 401, `contacts` → empty,
  `customer` → no list. Recorded in `proposal.md` and in Engram.
- [x] 0.2 Measured what decides the mapping: `Cliente` unique 370/370, `Token`
  empty on every row, `Nombre` never blank, `Status` uniformly ACTIVE, and the
  phone distribution that drove D4/D5.
- [x] 0.3 Probe scripts print AGGREGATES only — no name, phone, email or
  address of a real customer was written to a log.

## WU1 — extract the shared Interfuerza client (its own PR)

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

- [ ] 2.1 RED/GREEN client — `action: "customers"`, list key `customers`,
  pagination arithmetic against a `count` of 370.
- [ ] 2.2 RED mapper — `Nombre` → `name`; `Telefono_1` then `Cellular` →
  `phone`, VERBATIM (D4); `Email` → `email` or null; `Cliente` → `externalId`.
- [ ] 2.3 RED mapper — a row with no phone in any of the three fields yields a
  SKIP with a reason, not a row and not a throw (D5).
- [ ] 2.4 RED mapper — `Token` is never read. A guard test, because it is named
  like an id and is empty on all 370 rows.
- [ ] 2.5 RED mapper — `Contacto` is never used as a name fallback (D2); a row
  with a blank `Nombre` is a skip, not a silently-renamed customer.

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

- [ ] 6.1 New requirement in the delta. **Grep every requirement in the
  capability for the shapes this change touches** — `phone`, `cliente`
  identity — not only the one being added. That is the lesson C2 learned at
  round 10, when R19 was left affirming the opposite of the code.

## Known before starting

- [ ] **353 imported customers will not be able to receive a WhatsApp
  reminder**, because raw 8-digit Panama numbers are not E.164. The owner was
  shown this and chose raw. Fixing it later is a data migration over
  `cliente.phone`, not a code change.
- [ ] `Status` is uniformly `ACTIVE` across all 370, so nothing exercises a
  mapping onto `deactivatedAt` and none is written.
