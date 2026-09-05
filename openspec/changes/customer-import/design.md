# Design: import customers from Interfuerza

## D1 — extract the paginated fetch, do not copy it

`inventory-sync/client.ts` already holds sequential awaited pagination, a
3-attempt retry with a 60s interval, `RATE_LIMIT_SPACING_MS = 500`, and
`SyncAbortError` — whose meaning is subtle and load-bearing: *abort the whole
run and keep prior DB state*, never *skip this page*.

Copying that for customers would duplicate the one piece of this integration
that carries a **real 1-hour IP ban risk** if it is got wrong (~20 req/10s).
Two copies drift; the second one drifts silently.

So the machinery moves to `src/shared/interfuerza/client.ts`, parameterised by
`action` and by the response's list key. `inventory-sync/client.ts` keeps its
exact public API and delegates. **Its existing tests are the proof the
extraction changed no behaviour** — if they need editing, the refactor was
wrong.

Rejected: a second client under `customer-import/`. Rejected: generalising
further than two callers need. Two is the number that justifies the seam.

## D2 — `Cliente` is the identity, `Token` is a trap

`cliente.externalId text` (nullable, migration `0018`), holding Interfuerza's
`Cliente` value. 370/370 present and 370/370 unique in the live data.

Nullable because every customer created through the app has no external id,
and that is the normal case going forward — this column marks provenance, not
a requirement.

**`Token` is empty on all 370 rows.** It is named like an identifier and is
not one. Written here because the next person will reach for it.

Not UNIQUE at the database level, for the same reason `phone` is not: this
change does not need a constraint to be correct, and one more unique index is
one more thing that rejects a legitimate row later. The import matches on it;
nothing else does.

## D3 — re-runnable, matched on external id

The import is manual and may be run repeatedly. Per row:

- external id already present → UPDATE that customer's mapped fields
- not present → INSERT
- no phone in any field → SKIP, and report it

Matching on `externalId`, never on phone or name. Phone cannot identify a
customer here — the live data has 9 numbers shared by 18 people, which is the
whole reason `customer-shared-phones` exists.

An update MUST NOT touch fields this app owns and Interfuerza does not:
`whatsappOptOut`, `emailOptOut`, `deactivatedAt`, and the vehicle collection.
Re-running an import must never resurrect a customer the workshop deactivated
or undo a consent choice.

## D4 — phones are imported raw, and that is a decision with a cost

`Telefono_1` → `phone`, falling back to `Cellular`, verbatim.

Measured: `Telefono_1` on 361/370 (8 digits ×353, 11 ×7, 7 ×1), `Cellular` on
45/370, `Telefono_2` empty everywhere.

The owner chose raw over normalising to `+507`. The cost, stated so it is not
rediscovered as a bug: **an 8-digit number is not E.164, so those customers
cannot receive a WhatsApp reminder.** `runReminder` will attempt the send with
whatever is stored. Normalising later is a data migration over a known column,
not a code change.

`Telefono_1` before `Cellular` because it is present 8× more often — picking
the mobile-sounding field would leave 316 customers with no phone at all and
skip them.

## D5 — the 9 phone-less rows are skipped, and named

`phone` is `NOT NULL` and R17 requires it. The options were to invent a value,
to write `""` (which passes the column and fails the app's own validation), or
to skip. Only skipping is honest, and only skipping WITH a report is useful:
the result lists them by name and external id so the owner can add the real
number.

A skip is not a failure. The run completes and reports.

## D6 — one transaction, like the inventory sync

The whole import commits or none of it does. A partially-imported customer
list is worse than an empty one, because staff cannot tell which half is
missing. Mirrors `inventory-sync/job.ts`, and is what makes `SyncAbortError`'s
"keep prior DB state" meaning hold.

## Testing strategy

| Surface | How |
|---|---|
| the extracted client | `inventory-sync/client.test.ts` UNCHANGED — that is the assertion |
| the customers client | unit, injected `fetchImpl`/`sleepImpl`, page-count arithmetic against `count = 370` |
| the mapper | unit, over the real field shapes recorded in `proposal.md` |
| insert vs update vs skip | unit on the planner, with the DB seam injected |
| app-owned fields survive a re-run | **e2e** — a green unit run proves nothing about the real `UPDATE` |
| the whole run | e2e against real Postgres, twice, asserting the second is idempotent |

The re-run assertions are the ones that matter. Every unit test injects the DB
seam, so the actual `SET` list — the thing that could clobber `deactivatedAt` —
never executes under `npm test`.
