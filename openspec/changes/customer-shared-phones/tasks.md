# Tasks: shared phone numbers, and `phone NOT NULL`

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~180 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single PR off `main` |

One PR. The two pieces touch the same column but not the same code: the
migration is schema-only, the override is service/route/form. Splitting them
would put a `NOT NULL` migration on `main` in its own PR for no rollback
benefit — the column is already effectively non-null in practice.

## WU1 — the override

Files: `src/modules/customers/service.ts`(+test), `src/app/api/customers/route.ts`(+test),
`src/app/api/customers/[id]/route.ts`(+test), `src/modules/customers/CustomerForm.tsx`(+test).

- [x] 1.1 RED `service.test.ts` — `createCliente` with `allowDuplicatePhone: true` inserts instead of throwing `DuplicatePhoneError`; without it, still throws.
- [x] 1.2 GREEN `service.ts` — read the flag off the validated-away raw input, gate the existing throw on it.
- [x] 1.3 RED `service.test.ts` — same pair for `updateCliente`. The self-match exemption (a customer keeping their own phone) must keep working with the flag absent, unchanged.
- [x] 1.4 GREEN `service.ts` — same gate in `updateCliente`.
- [x] 1.5 RED `route.test.ts` (both routes) — a body carrying `allowDuplicatePhone: true` reaches the service; a body without it still produces `409`.
- [x] 1.6 CONFIRMED, not assumed: both routes forward the raw body whole (`createCliente(body, deps)`, `updateCliente(id, body, deps)`), so no route change was needed. A test on each route now pins that — mutation-verified by making the POST route strip the key, which failed it.
- [x] 1.7 RED `CustomerForm.test.tsx` — on `409`, the form renders the existing customer as a real link plus a confirm control; taking the confirm re-submits and saves.
- [x] 1.8 RED `CustomerForm.test.tsx` — the confirmation does not survive: after a successful shared-phone save, reopening the form and submitting again sends no flag.
- [x] 1.9 GREEN `CustomerForm.tsx` — 409 state holds `existingClienteId`; confirm control re-submits with the flag; state cleared on close (`handleOpenChange` already resets `errors`, extend it).

## WU2 — `phone NOT NULL`

Files: `src/shared/db/schema.ts`, `src/shared/db/migrations/0016_*.sql`.

- [x] 2.1 `schema.ts` — `phone: text("phone").notNull()`.
- [x] 2.2 Migration `0016_cliente_phone_not_null.sql` (renamed from drizzle-kit's generated `0016_clear_husk`, journal tag updated to match).
- [x] 2.3 Live smoke, run against the Docker dev DB (`proyectocatalogo-db-1`, port **5433** — the native Postgres on 5432 is an empty scaffold stuck at migration 7 and holds nothing). Pre-check returned **0** rows with a null or empty phone, so `0016` applied cleanly; 17 migrations, the one existing customer intact. Six assertions against the real database, each write rolled back:
  1. `information_schema` reports `is_nullable=NO`
  2. the existing row survived
  3. a null `phone` is REJECTED — *the first attempt at this test was invalid and passed for the wrong reason: `cliente.id` has no database default (`$defaultFn` is application-side), so an insert omitting it fails on `id`, never reaching `phone`. Re-run with `gen_random_uuid()`.*
  4. an EMPTY STRING is ACCEPTED — R19's phone-less row still representable
  5. two customers with the SAME phone are ACCEPTED — no UNIQUE, the load-bearing decision
  6. no unique index on `cliente` besides the primary key
- [x] 2.3b `npm run test:e2e` — 31/31 against a throwaway `dforce_e2e_smoke` database, dropped afterwards. This is what actually exercises the changed e2e fixture (`phone: ""`) through real Drizzle, real pg-boss and a real Chromium render; it had been edited in WU2 and never run.

> **NOT covered by any of the above: the owner's 364-record dataset is not in any local database.** The dev DB holds one customer. The pre-check that matters — null or empty phones among those 364 — still has to run wherever that data actually lives, BEFORE `0016` is applied there.

- [x] 2.4 UNPLANNED, found by the compiler: `NOT NULL` broke five fixtures built with `phone: null`, in `route.test.ts`, `schedule.test.ts`, `CustomerPicker.test.tsx` and the e2e seed. Each covers a real behaviour — R19's phone-less row, and `planReminders` skipping WhatsApp. **NOT NULL forbids a null, not an empty string**, and both guards test truthiness (`schedule.ts:51`, `CustomerPicker.tsx:25`), so the fixtures moved to `phone: ""` and every branch stays live. Nothing was deleted and no guarantee was dropped.
- [x] 2.5 `schema.test.ts` — the nullable-contact-fields assertion now states the new contract, plus a new test that phone is NOT unique anywhere (mutation-verified with a temporary `.unique()`). That decision is the easiest thing for a later change to tidy into existence.

## WU3 — the writing-down

- [x] 3.1 Delta spec: R18 rewritten (block → refuse-then-confirm), R17 amended for the column. Both already drafted.
- [x] 3.2 `proposal.md` records the accepted race, so the next change contradicts a decision instead of discovering a gap.

## Follow-ups (out of scope here)

- [ ] The six genuinely fragmented duplicate pairs are still two records each. Merging them is a data task with no code in it, and needs the owner to say which record wins per pair.
