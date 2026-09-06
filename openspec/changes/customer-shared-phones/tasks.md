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

## WU4 — GGA round 1 findings (all three real, all three fixed)

GGA `--pr-mode --diff-only` returned **FAILED** on the first run. Every finding
was verified before acting on it; none was taken on the reviewer's word.

- [x] 4.1 **BLOCKING — the R17 delta was a fragment, not a restatement.** The
  archiver REPLACES the matching requirement in the main spec; it does not
  merge. Confirmed against the archived `customer-search-and-picker` delta,
  which restates R19's entire paragraph and re-lists every scenario, including
  ones marked `(unchanged)`. My R17 block carried only the `NOT NULL`
  amendment, so archiving it would have silently deleted the required/optional
  field set, the per-vehicle `plate` rule, both format rules and all 7 existing
  scenarios. **This is the exact failure this project has already shipped
  twice.** R17 is now restated in full: 7 original scenarios + 2 new.
- [x] 4.2 `full-flow.e2e.test.ts` — the fixture moved to `phone: ""` in WU2 but
  the variable was still `nullPhone`, the test was still named "…with a NULL
  phone", and the describe's docstring still justified itself with
  `NULL ILIKE x`. With `0016`, no branch of `buildClienteSearchWhere`'s `or()`
  can yield NULL at all. Renamed to what it now proves — an EMPTY phone does
  not drop the row — and the docstring now says plainly that this is a
  narrower guarantee than the one it replaced.
- [x] 4.3 **The anti-uniqueness guard had a hole, and it was the load-bearing
  test.** Drizzle spells uniqueness three ways landing in three different
  places on `getTableConfig`; the original checked two. Verified empirically:
  a table-level `unique("cliente_phone_unique").on(table.phone)` passed it
  **44/44**. Now checks `uniqueConstraints` as well, and all three shapes were
  re-probed — each fails the test by name. The index assertion is also scoped
  to `phone` rather than the whole table, so an unrelated future unique index
  on `email` does not produce a misleading red under a phone-named test.

## WU5 — GGA round 2 findings (four, all verified, all fixed)

Round 2 returned **FAILED** with four convention/process findings and no
correctness ones. Each was checked against the codebase before acting.

- [x] 5.1 `CustomerForm.tsx` — `role="alert"` wrapped a link and a button.
  Counted: the repo has **43** `<p role="alert">` and exactly one `<div>` —
  mine. A live region announces changed text; it is not a container for
  focusable children with their own semantics, and that matters most here
  because those two controls are the ONLY way past the refusal. Moved to the
  paragraph.
- [x] 5.2 `CustomerForm.tsx` — raw `<a>` where 10 files use `next/link` and
  only one raw anchor existed. Not just convention: this renders inside an
  OPEN dialog, so a full page reload throws away everything the operator has
  typed. Now `<Link>`.
- [x] 5.3 `.atl/skill-registry.md` had slipped into commit `699e640` through a
  bare `git add -A` — an auto-generated date bump with nothing to do with this
  change. It had been deliberately excluded from the first two commits and was
  lost on the third. Restored to `main`'s version.
- [x] 5.4 `design.md` was missing. Checked: **every other change in
  `openspec/changes`, archive included, has one** — this was the sole
  exception. Written, holding the four decisions that were previously split
  between `proposal.md` and code comments: the override's shape and the
  `persistedPatch` trap, the confirmation's lifetime as a structural
  guarantee, the accepted race, and why `NOT NULL` deleted nothing.

## WU6 — the silent save, found reviewing the PR two levels up

- [x] 6.1 **`CustomerForm.submit()` was `try/finally` with no `catch`, and WU1
  gave it a second entry point.** `fetch` REJECTS on a network failure rather
  than returning a non-ok response, so the dialog re-enabled with nothing on
  screen and the operator clicked into the same silence. `UserForm.tsx:167`
  already carries this exact catch, with a comment recording that the same
  defect stranded a blocked user in `user-lifecycle` WU3 — this form never got
  it.
  It matters twice here: "Guardar igual" (`onClick={() => submit(true)}`) is a
  floating promise off a click handler, with no form submission behind it to
  surface anything at all.
  Same copy as `UserForm`, verbatim, rather than a second phrasing of the same
  sentence.
- [x] 6.2 **RED first**, both entry points: three tests written, all three red
  against the unfixed component, then green. Folded to two — a third asserting
  "Guardar re-enables" could not fail on its own, because without the catch it
  waits for an alert that never appears, so it was only re-asserting the first.
  A test that cannot fail alone is not a second test.
- [x] 6.3 **Mutation-verified by removing the catch BODY**, not the `catch`
  itself: a bare `catch {}` would swallow the rejection and satisfy any test
  that only checked the button re-enabled. Both rows go red by name.
- [x] 6.4 Gates: `npm test` 1084/1084, `tsc --noEmit` clean, lint 0 errors /
  15 warnings (the documented baseline).

Found by GGA reviewing #70, which cannot fix it: both files live on this
branch, and AGENTS.md's chained-PR rule says a change to this branch's files
does not ride in a PR two levels down.

## Follow-ups (out of scope here)

- [ ] **`ServiceOrderForm.handleSubmit` has the same `try/finally` shape** with
  no `catch` (`src/modules/service-orders/ServiceOrderForm.tsx:248`). Raised in
  the same GGA round. Not fixed here: this branch does not touch that file, and
  fixing it here would be the same rule violation in the other direction. It
  needs its own change, with the same RED-first and body-removal mutation.

- [ ] The six genuinely fragmented duplicate pairs are still two records each. Merging them is a data task with no code in it, and needs the owner to say which record wins per pair.
