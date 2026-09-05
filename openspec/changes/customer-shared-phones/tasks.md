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
- [ ] 2.3 Live smoke against the real 364-row data: `SELECT count(*) FROM cliente WHERE phone IS NULL OR phone = ''` BEFORE migrating. **If it returns anything but 0, stop and report — do not invent phone numbers to satisfy the constraint.** The rows belong to the owner.

- [x] 2.4 UNPLANNED, found by the compiler: `NOT NULL` broke five fixtures built with `phone: null`, in `route.test.ts`, `schedule.test.ts`, `CustomerPicker.test.tsx` and the e2e seed. Each covers a real behaviour — R19's phone-less row, and `planReminders` skipping WhatsApp. **NOT NULL forbids a null, not an empty string**, and both guards test truthiness (`schedule.ts:51`, `CustomerPicker.tsx:25`), so the fixtures moved to `phone: ""` and every branch stays live. Nothing was deleted and no guarantee was dropped.
- [x] 2.5 `schema.test.ts` — the nullable-contact-fields assertion now states the new contract, plus a new test that phone is NOT unique anywhere (mutation-verified with a temporary `.unique()`). That decision is the easiest thing for a later change to tidy into existence.

## WU3 — the writing-down

- [x] 3.1 Delta spec: R18 rewritten (block → refuse-then-confirm), R17 amended for the column. Both already drafted.
- [x] 3.2 `proposal.md` records the accepted race, so the next change contradicts a decision instead of discovering a gap.

## Follow-ups (out of scope here)

- [ ] The six genuinely fragmented duplicate pairs are still two records each. Merging them is a data task with no code in it, and needs the owner to say which record wins per pair.
