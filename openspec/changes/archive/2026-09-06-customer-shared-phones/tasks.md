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

> **RESOLVED 2026-09-06 — there is no such dataset to pre-check.** This was recorded as merge-blocking on the premise that the owner's 364 customers were rows somewhere waiting to be migrated. They are not: those 364 live **in Interfuerza**, and C6 is the change that imports them — it already skips the 9 phone-less ones by design and names each. There is no deployment (`README.md:207`, *"Nothing is deployed anywhere yet"*), no deploy config of any kind in the repo, and no `DATABASE_URL` anywhere off `localhost`.
>
> Ran the check on every reachable database — `total | phone_null | phone_blank | phone is_nullable | migrations`:
>
> | database | result | |
> |---|---|---|
> | 5433/`dforce_catalog` (what `.env` uses) | `1 \| 0 \| 0 \| NO \| 18` | `0016` already applied, cleanly |
> | 5433/`dforce_c2` | `6 \| 0 \| 0 \| NO \| 18` | same |
> | 5433/`dforce_e2e` | `0 \| 0 \| 0 \| YES \| 15` | throwaway |
> | 5432/`dforce_catalog` (native) | `0 \| 0 \| 0 \| YES \| 7` | empty scaffold |
>
> `0016` has nothing to fail on. It still hard-fails rather than coercing, deliberately — so the check belongs in the **first-deploy** checklist, not this merge:
> `select count(*) from cliente where phone is null or btrim(phone) = '';`

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

## WU7 — GGA round 3 findings (two real, one already answered)

- [x] 7.1 **`handleOpenChange`'s `setSharedPhoneWith(null)` was defended by
  nothing.** GGA deleted the line and watched 32/32 pass; I reproduced it before
  fixing anything. `design.md` D2 names that exact line as half of the
  structural guarantee and `tasks.md` 1.8 sells it — an invariant asserted in a
  doc and in no test.
  **Why the existing test could not catch it**: it reopens the dialog and then
  types into Teléfono, which fires the OTHER clear (`onChange`), then clicks
  plain "Guardar", which passes `false` by parameter and could never have
  carried the flag. Three exits, all closed before the assertion ran.
  One line, asserted immediately after reopening and before any typing.
  `toFormState` resets `phone` to `""` on reopen, so with the clear removed the
  refusal block renders and *"does not carry the confirmation into a later
  save"* goes red by name — verified.
  This is WU6.2's own rule (*"a test that cannot fail alone is not a second
  test"*) applied to a test written three rounds earlier.
- [x] 7.2 **A comment recorded a guarantee the code does not deliver.** The
  `Link` comment said a raw `<a>` "would throw away everything the operator has
  typed" — but a client-side navigation unmounts this dialog too, so the typed
  data is gone either way. `Link` is still right (repo convention, no full
  document reload); the comment now says what it actually buys, and names the
  behaviour that WOULD preserve the form (opening the existing customer beside
  it) as a change nobody has asked for rather than pretending it is already
  there.
- [x] 7.3 GGA flagged migration `0016`'s pre-check as an open release gate. It
  was, when the round started; it is answered above under WU2 — there is no
  deployment and no dataset for it to fail on. Left in the first-deploy
  checklist, not this merge.

## WU8 — GGA round 4: this branch's own two rules, applied to itself

Both findings are the shapes WU7 accepted one file over, still standing. Both
mutation-verified here before being fixed, not taken from the report.

- [x] 8.1 **The `<Link>` was inside the `<p role="alert">`.** WU5.1 moved the
  Button out of the live region and the Link never followed, so the comment
  three lines above — citing "the repo's other 43 alerts are all text-only
  `<p>`" as its whole reason — described an invariant this paragraph was the
  single exception to. In the direction that matters: an alert region is
  announced as flat text, and the comment itself says the link and the button
  are the ONLY way past the refusal.
  The Link now sits beside the paragraph, exactly where the Button already is.
  Measured after: **45 `role="alert"` in `src/**/*.tsx`, 0 with a focusable
  child.** The invariant is now true rather than asserted.
- [x] 8.2 **`setErrors` deliberately NOT set on the 409 — and nothing defended
  it.** Re-adding the pre-`0016` bare-path error
  (`"… (ver /customers/existing-1)"`) beside `setSharedPhoneWith` left the file
  **32/32 green**; reproduced before fixing. `findByRole("link")` passes with a
  stale error still on screen, so the test named *"links to the existing
  customer instead of printing a bare path"* did not assert against the bare
  path at all.
  One line — `expect(screen.getAllByRole("alert")).toHaveLength(1)` — in that
  same test, which is already standing on the 409 with the block rendered. The
  same mutation now turns it red by name.
- [x] 8.3 **`service.ts`'s module docstring contradicted the decision it
  governs.** It called R18 a "block" (it is refuse-then-confirm since WU1) and
  the missing unique constraint a "deviation from the original assumption that
  a DB constraint existed" — an accident. It is a MUST NOT in the delta spec,
  the owner's trade in design.md D3, and guarded three ways in
  `schema.test.ts`. That docstring is the first thing someone opens before
  adding a unique index, and it was telling them to.
- [x] 8.4 Two nits closed: `design.md`'s `CHECK (phone <> '')` sentence
  overstated what the constraint would change (`validation.ts:70-72` already
  rejects an empty phone, so it closes the last door, not the first), and one
  comment line at 117 cols re-wrapped to the ~78 the block around it uses.

## WU9 — GGA round 5

- [x] 9.1 **WU8.4's own re-wrap left a worse line than the one it fixed** —
  129 cols inside a comment block that wraps at ~76, in the same file. Fixed.
  Not chased further: the repo has no enforced line width (no prettier config,
  ESLint does not check it) and 36 lines across these four files already exceed
  110. The defect was local inconsistency inside one block, not a repo rule.
- [x] 9.2 **The `catch` was wider than the message it prints.** `setOpen(false)`
  and `onSaved?.()` sat inside the `try`, so a parent's `onSaved` throwing
  printed "No se pudo conectar" over a customer that had just been created
  successfully. Both moved below the `try/catch`; the catch now covers the
  request and its body and nothing else.
  **NOT proven by a test, and the attempt is recorded rather than hidden.** I
  wrote one, then put the two lines back inside the `try` and the file stayed
  **33/33 green** — because `setOpen(false)` has already run by then, so the
  wrong message renders into a closed dialog nobody can read. GGA's own report
  says the same ("nobody sees it"). The change is correct and its effect is
  invisible from a component test, so the test was **deleted** under AGENTS.md's
  rule — *a test that passes with the fix reverted is a placebo* — and the
  reason left in the file where the test would have been.
  `UserForm.tsx:167` has the identical shape; not fixed here, recorded below.
- [x] 9.3 **Two comments were review-session changelog.** One narrated a
  previous version of the comment above it (14 lines about what an earlier
  comment used to claim); the other cited "the repo's other **43** alerts" — a
  census that WU8.1 itself re-measured at 45 three lines away, and that rots
  every time anyone adds an alert. Both cut to the rule they buy: nothing
  focusable inside a live region, and why `Link` rather than `<a>`. AGENTS.md's
  first paragraph, applied to code comments.
- [x] 9.5 **The first-deploy check moved out of the change folder.** GGA's
  round-5 pass flagged that the `select count(*) … where phone is null or
  btrim(phone) = ''` lived only here, and this folder gets archived — so the
  one instruction that stands between `0016` and someone's real data would
  have evaporated with it. It is now in `README.md`'s "before a first deploy"
  list, beside the PDF-queue drain, with why `0016` hard-fails rather than
  coerces.
- [x] 9.4 **Gates re-run and recorded here**, which 6.4 was the last to do
  before WU7 and WU8 changed four files: `npm test` **1084/1084** (79 files),
  `npx tsc --noEmit` clean, `npm run lint` 0 errors / 15 warnings — the
  documented baseline.

## Follow-ups (out of scope here)

- [ ] **`UserForm.tsx:167` has the same over-wide `catch`** — `setOpen`/
  `onSaved`-equivalent work sits inside its `try`, so a parent throwing after a
  successful save gets blamed on the network. Same fix, two lines, but that
  file belongs to `user-lifecycle-management`, not this change. Raised at GGA
  round 5.

- [ ] **`ServiceOrderForm.handleSubmit` has the same `try/finally` shape** with
  no `catch` (`src/modules/service-orders/ServiceOrderForm.tsx:248`). Raised in
  the same GGA round. Not fixed here: this branch does not touch that file, and
  fixing it here would be the same rule violation in the other direction. It
  needs its own change, with the same RED-first and body-removal mutation.

- [x] ~~The six genuinely fragmented duplicate pairs are still two records each.~~ **Dropped by the owner 2026-09-06 — omitted, not deferred.** They stay as two records each. This is recorded as a decision rather than deleted, so the next person who finds those pairs knows someone looked and chose to leave them.
