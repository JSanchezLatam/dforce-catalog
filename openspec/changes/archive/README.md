# Archived changes

Every change in this folder is complete and merged to `main`. Nothing here is
active work. New changes go in `openspec/changes/<name>/`, not here.

| Change | Tasks | Landed |
|--------|-------|--------|
| `crm-workshop-management` | 41/41 | customers, service orders, reminders |
| `adaptive-catalog-layouts` | 19/19 | image classification, adaptive cards, review step |
| `crm-shell-settings-rbac` | 46/46 v1 | grouped nav, workshop settings, role matrix |
| `user-lifecycle-management` | 40/40 | deactivation, forced password change, admin user management |
| `service-history-per-vehicle` | 41/49 | per-vehicle service history, permanent deletion |
| `customer-shared-phones` (C1) | 41/43 | refuse-then-confirm on a shared phone, `phone NOT NULL` |
| `customer-deactivation` (C2) | 64/70 | `cliente.deactivated_at`, excluded from list and picker |
| `customer-import` (C6) | 78/83 | Interfuerza customer import, idempotent re-runs |

The first four were archived 2026-08-11, `service-history-per-vehicle` on
2026-09-03, and C1/C2/C6 on 2026-09-06 — in that chronological order, which is
the order their delta specs must be applied in.

**C1, C2 and C6 all rewrite `customer-management`, and R19 carries edits from
both C1 and C2.** Applying C2's R19 before C1's silently reverts C1's fix
(`phone = null` → `phone = ""`, which migration `0016` made unconstructible).
Their unfinished-task counts above are not undone work: every open box is a
deferral register, listed below.

The three landed as a chained merge, `#68 → #69 → #70`. #68 gained four work
units after #69 branched off it, so #69 conflicted against `main` — both had
appended a `describe` at the end of the same test file, and both were kept.
Anyone repeating this: dry-run the whole chain into a throwaway worktree off
`origin/main` first, and check the real resolution byte-for-byte against the
dry-run's.

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

## Where the current spec actually lives

There is no `openspec/specs/` baseline in this repo, and these deltas do not
add up to one on their own. Reading the current contract means reading two
places:

1. **`.kiro/specs/dforce-catalog/requirements.md`** — the original baseline
   (Requisitos 1-12, Spanish). This is what the deltas' `R5`/`R6`/`R8`
   references point at. It carries its own errata: R1 and R3's original text
   describes the Interfuerza API as `GET /products`, which is wrong — see the
   correction notes inline, and `interfuerza-api-contract-fix`.
2. **The `specs/` folder of each change here**, applied in the table's order.

## Known merge debt

Consolidating the above into one `openspec/specs/<capability>/spec.md` tree was
NOT done as part of this archival, deliberately. It is not a mechanical merge:
the baseline is a 242-line Spanish document organized by numbered requirement,
while the 13 deltas are English and organized by capability. Producing one tree
means choosing a language for the consolidated spec and re-cutting the baseline
along capability lines — both are judgment calls, and a half-correct baseline is
worse than this pointer, because the next change would plan against it and
believe it.

Ten capabilities are involved. Three have more than one contributing delta and
must be applied in order:

- `catalog-generation` — adaptive-catalog-layouts, then crm-shell-settings-rbac
- `customer-management` — crm-workshop-management, then crm-shell-settings-rbac
- `service-orders` — crm-workshop-management, then crm-shell-settings-rbac

The other seven are single-source: `app-navigation`, `role-permissions`,
`template-config`, `user-account`, `user-management`, `workshop-reminders`,
`workshop-settings`.

### `customer-shared-phones` (C1, archived 2026-09-06)

2 open follow-ups, full text at
`archive/2026-09-06-customer-shared-phones/tasks.md`:

- **`UserForm.tsx:167` has the same over-wide `catch`** that C1 narrowed in
  `CustomerForm`: `setOpen`/`onSaved`-equivalent work sits inside its `try`, so
  a parent throwing after a save that SUCCEEDED gets blamed on the network.
  Belongs to `user-lifecycle-management`, not C1.
- **`ServiceOrderForm.handleSubmit` has no `catch` at all**
  (`src/modules/service-orders/ServiceOrderForm.tsx`) — the silent-save defect
  this project has now fixed three times elsewhere. Needs its own change, with
  the same RED-first and catch-body-removal mutation C1 used.

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
