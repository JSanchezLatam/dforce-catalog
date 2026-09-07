# Archived changes

Every change in this folder is complete and merged to `main`. Nothing here is
active work. New changes go in `openspec/changes/<name>/`, not here.

| Change | Archived | Tasks | `customer-management` | Landed |
|--------|----------|-------|----------------------|--------|
| `crm-workshop-management` | 2026-08-11 | 41/41 | ADDED R16–R19 | customers, service orders, reminders |
| `adaptive-catalog-layouts` | 2026-08-11 | 19/19 | — | image classification, adaptive cards, review step |
| `crm-shell-settings-rbac` | 2026-08-11 | 46/54 | ADDED access control | grouped nav, workshop settings, role matrix |
| `user-lifecycle-management` | 2026-08-11 | 40/40 | — | deactivation, forced password change, admin user management |
| `catalog-templates-and-workshop-info` | 2026-08-12 | 66/66 | — | catalog templates, workshop info on the PDF |
| `customer-search-and-picker` | 2026-08-29 | 28/28 | **MODIFIED R19** | async search, accent-insensitivity, near matches |
| `vehicles-one-to-many` (C3) | 2026-09-01 | 52/61 | **MODIFIED R16 R17 R18 R19**, ADDED vehicle collection | one customer, many vehicles |
| `service-history-per-vehicle` (C4) | 2026-09-03 | 41/49 | MODIFIED + ADDED vehicle detail | per-vehicle service history, permanent deletion |
| `customer-shared-phones` (C1) | 2026-09-06 | 41/43 † | **MODIFIED R17 R18 R19** | refuse-then-confirm on a shared phone, `phone NOT NULL` |
| `customer-deactivation` (C2) | 2026-09-06 | 64/70 | **MODIFIED R16 R19**, ADDED R20 | `cliente.deactivated_at`, excluded from list and picker |
| `customer-import` (C6) | 2026-09-06 | 78/83 | ADDED R21 | Interfuerza customer import, idempotent re-runs |
| `catalog-price-tier-choice` | 2026-09-06 | 20/22 | — | choose 1 or 2 ERP price lists per catalog (merged 2026-09-01 in PR #53) |

† One of C1's 41 is the duplicate-pair merge the owner **dropped**, struck
through and marked in that `tasks.md` rather than deleted. It counts as closed
because it will not be done, not because it was.

**The table is complete, and its ROW ORDER is the apply order.** The `Archived`
column is informational: four rows share 2026-08-11 and three share 2026-09-06,
so sorting by date gives an arbitrary permutation — including across C1/C2/C6,
the exact trio this warning exists for. A delta spec applied out of row order
reverts a later one silently.

`openspec/changes/` is supposed to hold only genuinely active work, and it did
not. The 2026-08-12 archival of `catalog-templates-and-workshop-info` copied the
folder instead of moving it, so a byte-identical duplicate sat there reading as
open work for three weeks; removed with this archive.

**`catalog-price-tier-choice` was the third instance of it, and it is now
closed.** That change shipped in PR #53 (merged 2026-09-01) and sat unarchived
for five days, so its delta was never applied and
`openspec/specs/catalog-generation/spec.md` went on saying "the review step
MUST NOT offer a price-tier selector" while
`src/modules/catalog-builder/CatalogBuilderForm.tsx:540` rendered
`<legend>Listas de precios</legend>` and its checkbox group. Archived
2026-09-06, immediately after the archive that found it.

**`customer-management` is where that bites.** Four changes rewrite R19 —
`customer-search-and-picker`, `vehicles-one-to-many`, `customer-shared-phones`
and `customer-deactivation` — because a `## MODIFIED Requirements` block
REPLACES the matching requirement rather than merging into it. Applying C2's
R19 before C1's, for one example, reverts `phone = null` → `phone = ""`, a
shape migration `0016` made unconstructible. The `customer-management` column
above exists so nobody has to open eleven folders to find that out.

Unfinished task counts are mostly not undone work — but only the changes with
a register below say so for themselves. **`vehicles-one-to-many` (C3) has 9
open boxes and no register**: three are real follow-ups (the mixed-language
validation payload, the missing `CustomerPicker` `onSaved` test, and staged
permanent deletion being invisible) and six are owner-reserved GGA/PR boxes
that were in fact done. Read that `tasks.md` directly until someone writes it
one.

C1, C2 and C6 landed as a chained merge, `#68 → #69 → #70`. #68 gained four
work units after #69 branched off it, so #69 conflicted against `main` — both
had appended a `describe` at the end of the same test file, and both were kept.
Anyone repeating this: dry-run the whole chain into a throwaway worktree off
`origin/main` first, and check the real resolution byte-for-byte against the
dry-run's.

**After any archive, BOTH of these must hold.** There is no `openspec` CLI
here to run, so they are the gate.

1. `rg '^## (ADDED|MODIFIED)' openspec/specs/*/spec.md` comes back **empty**.
   Those headers are merge INSTRUCTIONS — where to splice — and are consumed,
   not copied. One rode into the main spec on this very archive: it sat above
   two requirements it had nothing to do with, so the spec claimed C1/C2/C6
   added the vehicle collection model.
2. **Every folder left in `openspec/changes/` has an unmerged PR.** Check 1
   cannot catch a merged-but-unarchived change: its delta simply never gets
   applied, the main spec keeps the requirement that change replaced, and the
   grep stays clean the whole time. That is exactly how
   `catalog-price-tier-choice` hid for five days. As of 2026-09-06 the
   directory holds nothing but `archive/`, so both checks pass.

`crm-shell-settings-rbac` also carries eight unchecked boxes under "Deferred to
follow-up change". Those are a deferral register, not open work: all four units
shipped as `user-lifecycle-management`. See the note there.

## Open follow-ups carried forward

Archived `tasks.md` files sometimes carry unchecked boxes that are a
deliberate deferral register, not undone implementation work. Losing a
written follow-up inside an archived folder nobody reopens is how this
project lost a requirement twice before; this section exists so a follow-up
survives being found.

### `service-history-per-vehicle` (C4, archived 2026-09-03)

8 open follow-ups, full text at
`archive/2026-09-03-service-history-per-vehicle/tasks.md`:

- **1.18 — CLOSED 2026-09-03**, branch `fix/created-by-from-session`. Was:
  `createOrder` took `createdBy` straight from the request body
  (`src/modules/service-orders/service.ts:216`), so an API client could
  attribute an order to another user — the audit trail said whatever the
  caller wanted. Fixed at the route, which already held the session and simply
  was not using it for this: `createOrder({ ...body, createdBy: user.id })`.
  The spread ORDER is the fix — session after body, so a client-supplied value
  cannot win — and it is mutation-verified: reverse the two and the test
  reddens. Pre-existing, not introduced by C4.
- 1.19 — `GET /api/customers/[id]/vehicles` types its response as
  `Vehiculo[]`, but `createdAt`/`deactivatedAt` cross the wire as ISO
  strings, not `Date`. Nothing reads them today.
- 2.11 — `POST /api/service-orders` never got the PATCH route's text-field
  and `appointmentAt` parse hardening; same unchecked-assignment shape PATCH
  already closed for `description`/`appointmentAt`/`categoria`.
- 2.12 — the `categoria` submit gate is silent: `Guardar` disables on a
  missing `categoria` with no error slot and no `RENDERED_ERROR_FIELDS`
  entry.
- 3.10 — `customers/[id]/page.tsx` still renders an English
  permission-denied string; the identical string was fixed on the sibling
  page this change added.
- 3.11 — the order-history table markup is now duplicated between
  `customers/[id]/page.tsx` and `vehicles/[vehicleId]/page.tsx`; extract on
  the third copy, not before.
- 3.13 — the vehicle detail page runs two unbounded reads: its own history
  query, plus `getClienteById`'s full customer order history, fetched and
  discarded on every load.
- 3.15 — `datetime.test.ts`'s `it.each` runs 3 redundant host-zone
  assertions that all check the same string; trim to one the next time that
  file is opened.

### `customer-shared-phones` (C1, archived 2026-09-06)

**2 open follow-ups** in
`archive/2026-09-06-customer-shared-phones/tasks.md`, plus **one observation**
that is not a box in that file and will not be found by following the pointer —
it is marked below:

- **`UserForm.tsx:167` has the same over-wide `catch`** that C1 narrowed in
  `CustomerForm`: `setOpen`/`onSaved`-equivalent work sits inside its `try`, so
  a parent throwing after a save that SUCCEEDED gets blamed on the network.
  Belongs to `user-lifecycle-management`, not C1.
- *(observation, not in `tasks.md` — raised reviewing this archive)*
  **`customer-management`'s R17 rationale pins `schedule.ts:51` and
  `CustomerPicker.tsx:25` by LINE NUMBER**, which rots on the next edit to
  either file. Not changed when merging: the block is byte-identical to C1's
  delta, and that property is worth more than the fix. Name the function next
  time the rationale is touched for any other reason.
- ~~**`ServiceOrderForm.handleSubmit` has no `catch` at all**~~ — **CLOSED
  2026-09-06** on `fix/service-order-form-catch`, RED-first and
  mutation-verified by removing the catch body. It was the last of the three
  forms without one.
- **All three save dialogs' `catch` also swallows a `response.json()` throw on
  a 2xx**, so an order/customer/user that WAS created could surface as "no se
  pudo conectar". Narrow, and identical in `UserForm`, `CustomerForm` and
  `ServiceOrderForm` — consistency rather than a regression any one of them
  introduced. Raised by GGA on the `ServiceOrderForm` fix. If it is ever fixed
  it gets fixed in all three at once.
  **No shared submit helper exists, and the entry below is not one.** That
  entry once pointed here as the moment to extract one; when it was closed,
  only the shared SENTENCE moved (`CONNECTION_ERROR`). A `submitJson()` was
  considered and rejected on the spot: the call sites branch on different
  status codes and write to different surfaces (`setErrors({ form })` vs
  `addToast`), so wrapping three lines behind a shared result type would be
  more code, not less. Anyone fixing this `json()` throw is starting from four
  independent `catch` blocks, not from a helper.
- ~~**`OrderStatusControls.transitionTo` has the same shape**~~ — **CLOSED
  2026-09-06** on `fix/status-controls-catch`, together with the shared copy
  constant. It had no test file at all; it has three now. The sentence itself
  had been hand-copied into **five** places — `OrderStatusControls` is the
  sixth surface and held none, because it was the one still missing its
  `catch`. It moved to
  `src/shared/ui/messages.ts` as `CONNECTION_ERROR` — one definition, and the
  tests still assert the literal so a bad edit to it goes red rather than
  moving both sides at once. That net had three holes when it was extracted —
  two assertions matched a prefix and one matched `/no se pudo/i`, so rewriting
  only the sentence's tail left those files green. All three were widened, and
  it is now measured: replacing the whole sentence and replacing only its tail
  turn the SAME 7 tests red across the same 6 files.

A third entry — merging the six genuinely fragmented duplicate customer pairs —
was **dropped by the owner on 2026-09-06**, omitted rather than deferred. It is
marked as a decision in that `tasks.md` rather than deleted, so the next person
who finds those pairs knows someone looked.

### `customer-deactivation` (C2, archived 2026-09-06)

6 open follow-ups, full text at
`archive/2026-09-06-customer-deactivation/tasks.md`. The two worth knowing
before touching that code:

- **`pendingPushes` can be decremented by an EXTERNAL navigation** landing
  between two of `CustomerFilters`' own pushes, releasing `pushedParamsRef`
  early. Bounded and self-correcting, but it is a real window.
- **`gga run --pr-mode` ignores `PR_BASE_BRANCH` as an environment variable** —
  a hole in `AGENTS.md`'s own guidance, which tells you to pin it that way.

### `customer-import` (C6, archived 2026-09-06)

5 open follow-ups, full text at
`archive/2026-09-06-customer-import/tasks.md`. The two that will matter first:

- **353 imported customers cannot receive a WhatsApp reminder**, because raw
  8-digit Panama numbers are not E.164. The owner was shown this and chose raw
  import. Fixing it is a data migration over `cliente.phone`, not a code change.
- **Layer 1's residual race.** `INSERT … WHERE NOT EXISTS` is not atomic under
  READ COMMITTED. The window is one INSERT round trip and layer 2
  (`pg_advisory_xact_lock`) still guarantees the customer data; a partial unique
  index on `status = 'running'` would close it structurally. Its own change.

## Where the current spec actually lives

`openspec/specs/` **is** the baseline for five capabilities —
`catalog-generation`, `customer-management`, `service-orders`,
`template-config`, `workshop-settings`. It has been since 2026-08-29. Read
those files directly; the deltas here are history, not the contract.

For the other five that appear in deltas — `app-navigation`,
`role-permissions`, `user-account`, `user-management`, `workshop-reminders` —
there is still no consolidated spec, and reading the contract means two places:

1. **`.kiro/specs/dforce-catalog/requirements.md`** — the original baseline
   (Requisitos 1-12, Spanish). This is what the deltas' `R5`/`R6`/`R8`
   references point at. It carries its own errata: R1 and R3's original text
   describes the Interfuerza API as `GET /products`, which is wrong — see the
   correction notes inline, and `interfuerza-api-contract-fix`.
2. **The `specs/` folder of each change here**, applied in the table's order.

## Known merge debt — half paid

When this folder was first written (2026-08-11) no capability had a
consolidated spec, and building one was declined as a judgment call rather than
a mechanical merge: the Kiro baseline is a 242-line Spanish document organized
by numbered requirement, while the deltas are English and organized by
capability.

**Five capabilities have since been consolidated** and are listed above. Five
have not. The reasoning for the remaining five is unchanged: producing a tree
means choosing a language for the consolidated spec and re-cutting the baseline
along capability lines, and a half-correct baseline is worse than a pointer,
because the next change would plan against it and believe it.

Which is which, as of 2026-09-06:

- **Consolidated in `openspec/specs/`** — `catalog-generation`,
  `customer-management`, `service-orders`, `template-config`,
  `workshop-settings`. Read those files; the table above is their delta
  history, not the contract. This list used to name only three, and used to
  credit `customer-management` with two contributing changes when it has eight.
- **Still no baseline** — `app-navigation`, `role-permissions`, `user-account`,
  `user-management`, `workshop-reminders`. Each is single-source, so the
  ordering problem does not arise for them; read the one delta plus the Kiro
  requirements above.

### `catalog-price-tier-choice` (archived 2026-09-06, merged 2026-09-01)

**2 open follow-ups** in
`archive/2026-09-06-catalog-price-tier-choice/tasks.md`:

- **A `tiers` validation error renders BEHIND the confirm modal.**
  `handleConfirmGenerate` sets `errors` and returns without closing the dialog,
  and `ConfirmGenerateDialog` has no error surface, so the message lands in the
  review card under the overlay. The jsdom test passes because jsdom does no
  layering. Pre-existing for `errors.total` and `errors.form` too; the fix is
  one error surface on the dialog, for all three.
- **`selection.ts`'s error messages are half-migrated** — the `tiers` ones are
  Spanish per the language rule, `categories`/`total`/`productsPerPage` are
  still English, and they render in the same form.

A third — "`npm test` is not reliably clean" — was **closed while archiving**,
not carried: the cause was worker contention starving `userEvent`, fixed by the
`maxWorkers: 2` cap on the jsdom project whose measurement lives in
`vitest.config.ts`. Verified 1242/1242, repeatedly, on 2026-09-06.

**Two amendments this archive had to make by hand, because the delta was
PARTIAL.** R6's block opened with "Amended for one sentence only; every other
clause of R6 stands unchanged" — but the archiver REPLACES, so applying that
block wholesale would have deleted `ProductPrintRef`'s extension, the
template/workshop branding rule, image-type card selection, and the
`productsPerPage`-is-a-maximum rule, none of which this change touches. R13 was
partial the same way, and would have taken the review table, the image-type
override and the `catalogs.generate` gate with it. Both were merged
sentence-by-sentence instead.

And one scenario the delta itself missed: R6's *"A zero tier renders an
em-dash"* still demanded that "Venta and Taller still show their bold prices"
while Socio em-dashes — three rows on one card, which this very change caps at
two. Unsatisfiable the moment it landed. Narrowed to a chosen pair, and
*"A missing tier renders an em-dash"* given an explicit chosen tier. This is
the failure C1 documented for R19: **full-restatement discipline follows the
DATA SHAPE, not only the requirement being edited.**
