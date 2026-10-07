# Verify Report: technicians-and-work-lines

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 7 WARNING, 4 SUGGESTION)

Mode: openspec store, Strict TDD active. Verified on `chore/archive-technicians-and-work-lines` (== main, all WUs merged).

## Gates (run fresh)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 193 files, 3049/3049 passed, exit 0 |
| `npm run lint` | 0 errors, 13 warnings (baseline 0/13), exit 0 |
| Full e2e on throwaway `dforce_e2e` (created, dropped after) | 16 files, 196/196 passed, 0 skipped, exit 0 |

Dev DB `dforce_catalog` untouched. Browser/LAN checks (3.5, 8.5) and curls (2.6, 5.8) were done by the orchestrator and are not re-run here.

## Completeness

All 7 WUs (1.x through 8.x) are `[x]`. Open: 9.1 and 9.2, which are the archive step itself and a follow-up list. Not blockers. No CRITICAL.

## Spec compliance

Coverage = a covering test that passed in the runs above. "(class)" = a test that pins `min-h-11`-style classes, not a rendered 44x44 (jsdom cannot measure; browser check covers it).

### technicians

| Scenario | Covering test |
|---|---|
| Technician without a login | `technicians/service.test.ts` "trims the nombre and creates an unlinked row for a jefe"; route.test "lets a jefe create an unlinked row" |
| One login, one roster row | service.test "refuses a link when the user is already linked, in Spanish"; `e2e/technicians.e2e.test.ts` "a second link ... DB UNIQUE"; `technicians-migration.e2e` "rejects a second roster row for one login" |
| Name is required | service.test "requires a non-blank nombre, in Spanish, and writes nothing"; TechnicianRoster.test "refuses a blank name inline" |
| Deactivation keeps history | service.test "deactivation sets deactivatedAt and reactivation clears it"; e2e "rename, deactivate and reactivate persist"; `order-scope.e2e` "a DEACTIVATED roster row still sees ..."; picker excludes: page.test "offers staff the active roster minus ..." |
| No delete path | `technicians-migration.e2e` "rejects deleting a technician who is assigned to an order"; no DELETE export (route-guards "declares no method the route does not export") |
| Existing técnico gets a linked row | `technicians-migration.e2e` "gives each técnico user exactly one linked roster row, named from name or else username" |
| Other roles not backfilled | same file "gives an administrador no roster row" |
| No assignment backfill | same file "creates no assignment" |
| Jefe creates a row without a login | service.test + route.test (above) |
| Jefe cannot link a login | route.test (PATCH) "denies a jefe carrying userId (even null) with 403"; service.test "refuses a jefe carrying userId, even null" |
| Administrador links a login | route.test "lets an administrador link: 200"; service.test "lets an administrador link, unlink ..." |
| Técnico refused | route.test (POST and PATCH) "denies a técnico with 403 before running anything"; page.test "refuses a técnico with the denial screen" |
| Mutations confirm | TechnicianRoster.test create / rename / "Técnico desactivado" / "Técnico reactivado" toast tests |
| Jefe refused on users | NO jefe-specific route test. Indirect: policy matrix test + route-guards "declared Action appears as a can() call" (see W3) |
| Jefe refused on workshop/template | Indirect only, same as above (W3) |
| Jefe cannot correct a closed order | `work-lines/route.test` "jefe_taller gets 403 and a password is never verified"; `service-orders/[id]/route.test` "answers an authorizer refusal for a non-administrator 403"; work-lines.test "a jefe (never granted) is refused with OrderClosedError" |
| Jefe keeps sync and catalog generation | `policy.test` "jefe_taller keeps sync.manual and catalogs.generate" (matrix only, no route test; W3) |
| Excluded entries are hidden | `nav-items.test` "jefe sees no Gestión de usuarios, Config. del CRM or plantillas entry anywhere" |
| Route-guard coverage | `route-guards.test` "every existing API route and page has a ROUTE_GUARDS entry" |

### order-work-lines

| Scenario | Covering test |
|---|---|
| Valid line persists | work-lines.test "trims the description and stamps created_by"; `order-work-lines.e2e` "a técnico logs their own line" |
| Non-positive/non-integer duration | work-lines.test `it.each([0,-5,1.5,"abc",1441,...])`; e2e "the CHECK rejects a direct insert of %i minutes"; migration e2e "rejects a duration of %i minutes" |
| Blank description | work-lines.test `it.each(["","   ",...])` "refuses description" |
| Hours per technician per month | `order-work-lines.e2e` "SUM(duracion_minutos) for A in October excludes B and November". The `(tecnico_id, fecha)` index is not asserted by any test (W6) |
| Técnico logs own time | work-lines.test "lets a técnico write their own line"; e2e |
| Técnico cannot log for another | work-lines.test "refuses a técnico naming another technician"; route.test "403 for a técnico naming someone else" |
| Line must name an assigned technician | work-lines.test "refuses a technician who is not assigned"; e2e "the service answers an unassigned technician in Spanish" + composite FK |
| Técnico on an unassigned order | work-lines.test "answers an order the scope cannot see as not found"; route.test "404 ..."; e2e "an unassigned técnico gets no row (404)" |
| Open order takes no lines | work-lines.test "refuses an open order for every role"; e2e "open takes no line" |
| Jefe corrects a line during review | work-lines.test "lets staff edit during review"; e2e "staff edit on ready_for_review leaves the order's status alone" |
| Técnico blocked after marking | work-lines.test "refuses a técnico who marked their part, until they un-mark"; e2e "a técnico who marked their part is refused" |
| Line technician is immutable | work-lines.test "cannot change the technician or the order"; e2e "an edit cannot move a line ..." |
| Status read under the lock | work-lines.test "evaluates the status of the LOCKED row" (unit with fake tx; lock itself proven by the readiness race e2e) |
| Last mark moves the order | parte-lista.test "sets the caller's own mark and, when it was the last one, returns ready_for_review"; readiness.test "moves ... with a timestamp" |
| First mark does not move it | parte-lista.test "leaves the order in_progress while another active assignee is pending" |
| Two simultaneous last marks | `order-readiness.e2e` "two simultaneous last marks end ready_for_review ..." and the FOR UPDATE wait test |
| Técnico un-marks | parte-lista.test "clears the mark and returns a ready_for_review order to in_progress"; e2e "un-marking returns a ready order to in_progress and clears only the caller's mark" |
| Cannot mark another's part | parte-lista.test "refuses a técnico naming another technician's assignment (403)"; route.test "403 naming ..." |
| Mark refused outside in_progress | parte-lista.test "refuses an open order", `it.each(done, cancelled)` "OrderClosedError"; route.test "409 for a status that takes no mark" |
| Deactivated technician does not block | readiness.test "ignores a deactivated assignee"; e2e "a deactivated, unmarked assignee does not block readiness" |
| Mark needs no work line | parte-lista.test "requires no work line: it never reads one" |
| Admin and jefe close regardless | transitions.test "lets a holder of service-orders.assign do %s -> %s"; `order-assignments.e2e` "an administrador can" close |
| Lines and totals shown | OrderWorkCard.test "totals the minutes per technician: 90 ... 45" |
| Técnico sees only their own mark control | OrderWorkCard.test "offers the mark to the viewer's own pending assignment and to nobody else" |
| Mutation confirms | OrderWorkCard.test "POSTs the mark, toasts 'Parte marcada como lista'"; WorkLineDialog.test "toasts above the refresh" |
| Controls meet the hit-target floor | OrderWorkCard.test "holds both controls at the 44px floor" (class); WorkLineDialog.test "holds the controls at the 44px floor" (class). Measured in browser by orchestrator |

### service-orders (delta)

| Scenario | Covering test |
|---|---|
| Order created with no parts, categoria, observaciones, one assignment | service.test "writes one assignment per technician in the same transaction"; `order-assignments.e2e` "writes the order and its assignments together, open" |
| Order may be created with no technician | service.test "creates an open order with no assignment and never reads the roster"; e2e "creates an open order with no assignment" |
| Deactivated technician refused (create) | service.test "refuses a deactivated technician ... creates nothing"; e2e "a deactivated technician refuses the whole create" |
| Técnico cannot create | `api/service-orders/route.test` "refuses a técnico with 403 and creates nothing"; list page.test "does not render it for a session without service-orders.create" |
| Invalid cliente / vehiculoId / cross-ownership / zero vehicles / observaciones / Piezas empty | pre-existing, still green (service.test, route.test, detail page.test "renders the Piezas utilizadas card in its empty state") |
| R21 transition scenarios (all 15) | transitions.test ("ready_for_review edges", "ready_for_review is never a manual target", `assertTransitionPermitted`); `[id]/route.test` "refuses a PATCH status of ready_for_review with 400", "lets a tecnico start work", "refuses a tecnico closing ... with 403", "lets an administrador return a ready_for_review order to in_progress"; service.test "clears every part-ready mark when staff send a ready_for_review order back"; `order-readiness.e2e` "sending a ready order back clears every mark, and re-marking ... makes it ready again"; list page.test "filters by ready_for_review"; StatusBadge.test |
| R23 técnico/admin/jefe `can()` | policy.test matrix; route tests |
| Reception photos: add gated by status, jefe adds during review | photos.test "refuses a técnico on a ready_for_review order", "accepts staff on a ready_for_review order"; photos route.test "403 ... técnico adding to a ready_for_review order" |
| Unassigned técnico cannot add or read photos | `order-assignments.e2e` "photo add: an unassigned técnico is refused as not found"; `order-scope.e2e` "photo GET lookup"; `photos/[photoId]/route.test` "looks the photo up through the caller's order scope" |
| Delete is administrador-only | `photos/[photoId]/route.test` "403 for a tecnico", "403 for a jefe_taller", "an administrador deletes the photo" |
| Other photo scenarios (JPEG, size, 13th, order, closed-order, serving, retention) | pre-existing, green |
| Edit gate: control matrix, unassigned PATCH 404, closed refusals, correction | edit-policy.test TRUTH_TABLE (jefe row, `ready_for_review` column); `[id]/route.test` (404 scoped lock, 403/409/correction cases); detail page.test; `order-assignments.e2e` "PATCH fields: an unassigned técnico gets 404 and the row is unchanged" |
| Order Assignment: admin/jefe assigns open | assignments.test; `order-assignments.e2e` "assigning on an in_progress order leaves its status" + idempotence; route.test `it.each(jefe_taller, administrador)` |
| Assigning during review reopens | assignments.test "returns a ready_for_review order to in_progress"; e2e "assigning during review returns the order to in_progress; the new mark is null" |
| Assigning on closed refused | e2e `it.each(done, cancelled)` "refuses a %s order and writes no row"; route.test "409 for a closed order, whoever asks" |
| Técnico cannot assign | assignments `route.test` "refuses a técnico with 403 before reading the order" |
| Duplicate is a no-op | assignments.test "is a no-op for a technician already assigned"; e2e "is idempotent" |
| Deactivated refused (assign) | assignments.test; e2e; route.test "400 under errors.tecnicoId" |
| Assignments never deleted | assignments.test "offers no way to remove an assignment"; migration e2e "rejects deleting an assignment that has work lines" and "rejects deleting a technician who is assigned" |
| Técnico scoping: list, search, direct routes, no roster row, admin/jefe see all, real SQL | scope.test; `order-scope.e2e` (list, count, detail, photo, customer, vehicle, "search 'perez'", "no roster row"); page.test "scopes the list AND the count by the session user"; detail/print page.test "an unassigned order is a 404"; scope.test `it.each(administrador, jefe_taller)` |

### service-order-corrections (delta)

| Scenario | Covering test |
|---|---|
| Admin adds / edits / deletes a line on closed | work-lines.test "work lines under correction": "add: writes `linea_trabajo` (null, id)", "edit: one `linea_trabajo.<campo>` row per CHANGED field", "delete: writes (id, null)"; `order-work-lines.e2e` "add, edit and delete write exactly the audit rows the spec names" |
| Line write refused without correction | work-lines route.test closed-order block (jefe/técnico 403, no password 409, wrong 403); e2e "without a grant a done order refuses every role" |
| Line must still name an assigned technician | work-lines.test "the technician must still be assigned under correction" |
| Marks and assignments not correctable | parte-lista.test closed `it.each`; assignments route.test "409 for a closed order ... never correctable"; `order-readiness.e2e` "a closed order refuses the assigned one". No test sends an administrator password with a mark specifically (W5) |
| Open-order writes not audited | work-lines.test "an open order writes no audit row even when a grant is passed"; e2e "an open-order write with a grant writes no audit row" |
| Audit and line commit or fail together | work-lines.test "a failing audit insert rejects the whole call"; e2e "a throwing audit insert ... leaves no line behind", "a throwing audit on delete keeps the line" |

### user-management (delta)

| Scenario | Covering test |
|---|---|
| Administrador creates a jefe | UserForm.test "offers Jefe de taller in the role selector and sends it as jefe_taller"; account service.test "does not touch the roster for an administrador or a jefe_taller" |
| Jefe cannot manage users | Indirect only (W3) |
| Admin floor unchanged with jefe users | NOT covered by a jefe-specific test. `activeAdminIds` is filtered by `role = 'administrador'` in `account/queries.ts:75`, a real-SQL line no unit test reaches (W4) |
| New técnico user gets a row | account service.test "ensures a roster row for a new técnico"; `technicians.e2e` "createUser as técnico creates the login and one linked row" |
| Promotion reuses an existing link | service.test "a role change to tecnico ensures the roster row"; `technicians.e2e` "promotion to técnico creates the row once, reuses an existing link" |
| Atomic with the user | service.test "propagates a roster failure"; `technicians.e2e` "a roster failure rolls the user insert back" |
| Demotion keeps the roster row | service.test "demotion, an unchanged técnico role ... leave the roster alone"; e2e "demotion keeps it" |
| Role selector, badge, filter show "Jefe de taller" | UserForm.test, UsersTable.test "shows Jefe de taller, not the raw jefe_taller". Filter option: no dedicated test found (S3) |

## Spec/design text that no longer matches what shipped (amend at archive)

1. **Wire key**: specs say `user_id` in the jefe-link scenarios (technicians: "Who Manages the Roster", "Jefe cannot link a login"); the wire is `userId`. Also tasks 1.4/2.3 say `user_id` for the HTTP body.
2. **Assignments route** takes ONE `tecnicoId` per POST (`[id]/assignments/route.test` "400 ... tecnicoId"); specs say "assign technician(s)" and creation takes `tecnicoIds` (that part is right).
3. **Audit edit values** are `"<lineId>: <value>"` (`work-lines.ts:210-211`), not the bare old/new value. `service-order-corrections` "Administrator edits a line's duration" says old 30 / new 45; reality is `"<id>: 30"` / `"<id>: 45"`. The spec does say "carrying the line id prefix", so the scenario wording is the only mismatch.
4. **Readiness timestamp**: specs ("Last mark moves the order": "with its transition timestamp recorded"; Mi Parte Lista: "record the transition timestamp") imply a dedicated column. `readiness.ts` writes only `updatedAt`. There is no per-status history column (the code comment says so). Reword to "updates `updatedAt`".
5. **Send-back clears marks**: R21 delta text already states it, but design.md Data Flow / Readiness edges and the proposal do not; design.md should gain the clear-on-send-back rule (task 7.6 added it late).
6. **Jefe also lacks `service-orders.deletePhoto`**: proposal.md In Scope still lists four exclusions (`users.manage`, `workshop.edit`, `template.edit`, `service-orders.correct`); tasks 1.6 lists five; spec and policy.test are right (five).
7. **proposal.md**: Intent says "orders assigned to 1+ technicians", Scope says "Admin/jefe create orders and assign". Creation allows ZERO (reconciled 2026-10-06; R20 and design already say so). Fix Intent.
8. **proposal.md Approach**: "Enum values added in their own migration file" and "`isAssigned(user, orderId)`" are both superseded. Design says a separate file does NOT isolate `ADD VALUE` (single-transaction `migrate()`), and the shipped predicate is `orderScope(user)`.
9. **Roster breakpoint**: spec/design/tasks 3.1 say table "from `sm:`"; `TechnicianRoster.tsx:136` uses `md:` (and its test says "from md up"), like `UsersTable`. Align the text to `md:`.
10. **Technician scoping "orders only; customer and vehicle access is unchanged"** (service-orders delta): shipped scoping also filters the orders listed inside the customer page and vehicle history (design Read paths and `order-scope.e2e` confirm). Customer/vehicle ACCESS is unchanged, but the sentence is misleading; clarify.
11. **tasks.md numbering**: WU4b uses 5.x, WU5 6.x, WU6 7.x, WU7 8.x (offset by one from the WU label). Cosmetic; do not renumber, archive as is.
12. **tasks 9.2** already lists follow-ups; two should be carried to the archive notes unchanged: re-assigning a now-deactivated technician already on the order answers 400 not a no-op; malformed JSON on technician routes answers 500 (note: `assignments/route.test` shows that route returns 400, so only the technician routes remain; re-check at archive).

## Issues

### CRITICAL
None.

### WARNING
- **W1** Spec text drift items 1-10 above. Amend at archive; none breaks behavior.
- **W2** Hit-target scenarios (roster, work card, assignment control, edit control) are proven only by class-pinning tests plus the orchestrator's browser run. By the repo's own rule that is the accepted evidence; flagged because a green suite is not proof.
- **W3** "Jefe refused on users / workshop / template" and "Jefe keeps sync and catalog generation" have no route-level test with a `jefe_taller` session. Coverage is `policy.test` matrix plus `route-guards.test`, which proves each route evaluates its declared Action. Sound by construction, but a route that gates on the wrong Action would still pass the first test.
- **W4** "Admin floor unchanged" with jefe users has no jefe-specific test, and the `role = 'administrador'` filter in `account/queries.ts:75` has no real-SQL e2e (injected-seam limit).
- **W5** "Marks and assignments are not correctable" is tested per role without a password for marks; no test sends an administrator with a correct password to a mark or un-mark on a closed order. The service never reads a grant for marks, so risk is low.
- **W6** The `(tecnico_id, fecha)` index named by the spec is not asserted by any test (the SUM e2e proves the result, not the index).
- **W7** Design says the status is "evaluated on the locked row"; the unit test proves it with a fake tx. The real lock is proven by the readiness race e2e only for `markParteLista`, not for `addWorkLine`.

### SUGGESTION
- **S1** Add a one-line jefe e2e/route row for W3 and W4 in a follow-up change, not now.
- **S2** Technician-route malformed JSON still 500s (tasks 9.2); guard with 400 in its own change.
- **S3** Add an explicit test for the "Jefe de taller" option in the users list role filter.
- **S4** Untracked `openspec/changes/metrics-dashboard/` is unrelated to this change; keep it out of the archive commit (never `git add -A` here).

## Design coherence

All Architecture Decisions hold in code: required `scope` argument (tsc-enforced), `readAll` exempt in route-guards, composite FK, `ready_for_review` declared before `done` (migration e2e "orders ready_for_review before done"), `applyReadiness` without `assertTransition`, `ensureRosterRow` on create and role change, `deactivated_at` soft delete. Deviations: items 4, 8 and 9 above.

## Verdict

PASS WITH WARNINGS. Ready for `sdd-archive`: amend the text in the list above at merge time, then check duplicates after the mechanical delta apply (task 9.1).
