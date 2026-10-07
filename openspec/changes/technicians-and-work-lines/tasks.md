# Tasks: Technicians, Assignments and Work Lines

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,900 total (tests ~55%): WU1 ~360, WU2 ~350, WU3 ~360, WU4a ~400, WU4b ~330, WU5 ~400, WU6 ~300, WU7 ~400; migration SQL and `meta/` snapshots excluded |
| 400-line budget risk | High (WU4a, WU5, WU7 sit at the line; WU5 and WU7 spill first) |
| Chained PRs recommended | Yes |
| Suggested split | Tracker draft branch `feat/technicians-and-work-lines` off `main`; WU1 base = tracker; each later WU base = previous WU branch; tracker merges to `main` last |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migrations 0028/0029, schema, `jefe_taller`, new Actions, guards | PR 1 (base: tracker) | `npx vitest run src/modules/auth src/modules/service-orders src/app/api/route-guards.test.ts` | e2e on throwaway `dforce_e2e`: migrations apply in ONE run from 0026, backfill, composite FK | Revert PR 1; tables additive, enum values stay unused |
| 2 | Roster service, routes, `ensureRosterRow` | PR 2 (base: WU1) | `npx vitest run src/modules/technicians src/modules/account src/app/api/technicians` | `src/e2e/technicians.e2e.test.ts`; curl at LAN IP as 3 roles | Revert PR 2; roster unused |
| 3 | Roster UI, role option in users UI, nav | PR 3 (base: WU2) | `npx vitest run src/modules/technicians src/modules/users src/modules/layout "src/app/(app)/technicians"` | Playwright 390/768/desktop, 3 logins | Revert PR 3; API stays |
| 4a | `orderScope` and all 7 read paths | PR 4a (base: WU3) | `npx vitest run src/modules/service-orders src/modules/customers "src/app/(app)"` | `src/e2e/order-scope.e2e.test.ts`, 7 rows | Revert PR 4a; reads unscoped again |
| 4b | Create with optional assignment, `create` refusal, lock `scope`, assignments route | PR 4b (base: WU4a) | `npx vitest run src/modules/service-orders src/app/api/service-orders` | e2e rows; curl as técnico/jefe/admin | Revert PR 4b |
| 5 | Work lines under the lock, audit, routes | PR 5 (base: WU4b) | `npx vitest run src/modules/service-orders/work-lines.test.ts src/app/api/service-orders` | `order-work-lines.e2e.test.ts` incl. composite FK, `SUM` | Revert PR 5 |
| 6 | Readiness, `ready_for_review` transitions, race | PR 6 (base: WU5) | `npx vitest run src/modules/service-orders` | e2e race: second connection holds `FOR UPDATE` | Revert PR 6 |
| 7 | Order UI: picker, work card, mark, badge, filter | PR 7 (base: WU6) | `npx vitest run src/modules/service-orders "src/app/(app)/service-orders"` | Playwright at `http://192.168.0.3:3000`, 390/768/desktop, tecnico + jefe_taller + administrador | Revert PR 7; API stays |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red BY NAME). Fixtures match the wire. Migrations come from `drizzle-kit generate --name <n>`, never hand-written except the 0029 backfill appended after generation; read each generated SQL. Workshop note (WU1 PR description): the workshop must run `standalone.ps1` to apply 0026-0029 in one run (0028 and 0029 are additive). E2E rows run on a throwaway `dforce_e2e`, never the dev DB. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 13 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous branch. Owner standing consent covers all Gentle AI reviews. Toast convention: above `router.refresh()`, below the `try/catch`, APPLIED counts. Threat matrix: N/A (design). Orders may be created with ZERO technicians (reconciled 2026-10-06).

## WU1: Migrations, schema, roles (PR 1)

- [x] 1.0 PRECONDITION: `plate-municipio` (0026) AND `closed-order-lock` (0027) merged to `main`. Create the tracker off updated `main`; confirm `src/shared/db/migrations` ends at 0027. Else STOP (blocked, not renumbered).
- [x] 1.1 `schema.ts`: `roleEnum` gains `jefe_taller`; `orderStatusEnum` gains `ready_for_review`. `drizzle-kit generate --name enum_jefe_ready` (0028); confirm the SQL is ONLY `ALTER TYPE role ADD VALUE 'jefe_taller'` and `ALTER TYPE order_status ADD VALUE 'ready_for_review' BEFORE 'done'`.
- [x] 1.2 `schema.ts`: `tecnico`, `orden_tecnico` (PK `(orden_id,tecnico_id)`, restrict FKs, index `(tecnico_id)`), `orden_linea_trabajo` (composite FK to `orden_tecnico`, CHECK `duracion_minutos > 0 AND <= 1440`, indexes `(tecnico_id,fecha)` and `(orden_id)`). Generate 0029; no SQL references a new enum value.
- [x] 1.3 Append to 0029 the backfill `INSERT INTO tecnico (id, nombre, user_id, deactivated_at, created_at) SELECT gen_random_uuid()::text, coalesce(nullif(btrim(name),''), username), id, deactivated_at, now() FROM users WHERE role = 'tecnico'`.
- [x] 1.4 RED e2e `src/e2e/technicians-migration.e2e.test.ts` (`dforce_e2e`, apply 0026-0029 in one run): one técnico user (blank `name`) gets one linked row named from `username`; an `administrador` gets none; zero `orden_tecnico` rows; second row for one `user_id` rejected; delete of an assigned tecnico rejected; line with unassigned technician violates composite FK; duration 0 rejected. GREEN: fix real-SQL defects.
- [x] 1.5 RED `roles.test.ts`: `jefe_taller` labelled "Jefe de taller". GREEN `roles.ts`.
- [x] 1.6 RED `policy.test.ts` exhaustive over `Record<Role, Grants>`: jefe holds every administrador grant except `users.manage`, `workshop.edit`, `template.edit`, `service-orders.correct`, `service-orders.deletePhoto`; keeps `sync.manual`, `catalogs.generate`; new Actions `service-orders.readAll`, `.create`, `.assign`, `technicians.manage` true for admin and jefe, false for técnico (`write` stays true). GREEN `policy.ts`.
- [x] 1.7 RED `route-guards.test.ts`: `service-orders.readAll` exempt like `catalogs.listAll`; guard rows for routes added later are declared per WU. GREEN.
- [x] 1.8 RED/GREEN tsc fallout: `edit-policy.ts` jefe row and `ready_for_review` column (exhaustive records), `statuses.ts`, `transitions.ts` map with `ready_for_review: ["in_progress","done","cancelled"]`, `StatusBadge` "Lista para revisión". `ready_for_review` is not accepted as a PATCH target (400).
- [x] 1.9 Mutation-verify 1.4-1.8 by name (grant jefe `users.manage`, drop CHECK, drop composite FK, omit `nullif`).

## WU2: Roster service and routes (PR 2)

- [x] 2.1 RED `technicians/service.test.ts`: create requires non-blank `nombre`; jefe supplying `userId` throws forbidden; admin link refused when the user is already linked (Spanish); deactivate/reactivate sets/clears `deactivatedAt`. GREEN `technicians/{service,queries}.ts`; no delete function.
- [x] 2.2 RED `account/service.test.ts`: `ensureRosterRow(tx,userId)` creates one linked row for new técnico; reuses an existing link; roster insert failure rolls back `createUser`; role change to `tecnico` in `updateUser` runs it; demotion or deactivation leaves the row untouched. GREEN.
- [x] 2.3 RED route tests `/api/technicians` POST and `[id]` PATCH: técnico 403, jefe with `user_id` 403, jefe create 201, admin link 200. GREEN routes; `route-guards.test.ts` rows (`["technicians.manage","users.manage"]` for link).
- [x] 2.4 RED e2e `src/e2e/technicians.e2e.test.ts`: duplicate link rejected by DB; atomic `createUser` rollback on forced roster failure; promotion reuses link. GREEN.
- [x] 2.5 Mutation-verify 2.1-2.4 by name. 2.6 curl at the LAN IP as técnico, jefe, administrador.

## WU3: Roster UI, user role option (PR 3)

- [x] 3.1 RED `TechnicianRoster` tests: `RecordCard` stack under `sm:`, table from `sm:`; create, rename, deactivate/reactivate toasts ("Técnico creado", "Técnico desactivado"); link control only for administrador; `min-h-11 min-w-11`. GREEN `TechnicianRoster.tsx`, `/technicians` page.
- [x] 3.2 RED users UI tests: role selector, badge and filter show "Jefe de taller"; admin-floor message unchanged. GREEN users components.
- [x] 3.3 RED `nav-items` test: "Técnicos" under Configuración for `technicians.manage`; jefe sees no Gestión de usuarios, workshop or template entries. GREEN `nav-items.ts`, `nav-badges.test.ts` fallout.
- [x] 3.4 Mutation-verify 3.1-3.3 by name.
- [x] 3.5 Playwright at `http://192.168.0.3:3000` as tecnico, jefe_taller, administrador at 390/768/desktop: console clean (RSC boundary, dialog portal), 44x44 measured.

## WU4a: orderScope and read paths (PR 4a)

- [x] 4.1 RED `scope.test.ts`: `orderScope(user)` returns no condition for `readAll` holders; an `EXISTS` over `orden_tecnico` for a técnico via their roster row; a técnico without a row gets a match-nothing scope; `SYSTEM_SCOPE` exists. GREEN `scope.ts`.
- [x] 4.2 RED `queries.test.ts`: `listOrdenesServicio`, `countOrdenesServicio`, `getOrdenServicioById`, `listOrdenesByVehiculo` take a REQUIRED `scope` (tsc fails when omitted). GREEN `queries.ts`, `customers/queries.ts` (orders in `getClienteById`).
- [x] 4.3 RED page/route tests: list, detail, print, photo GET, customer page, vehicle page each pass `orderScope(user)`; photo GET unassigned 404. GREEN callers; non-order callers pass `SYSTEM_SCOPE` explicitly.
- [x] 4.4 RED e2e `src/e2e/order-scope.e2e.test.ts` (7 rows: list, count, detail, photo GET lookup, customer orders, vehicle history, lock): técnico sees only the assigned order and gets null/404 on the other; search "perez" cannot reach unassigned; roster-less técnico sees empty. GREEN: fix real-SQL defects.
- [x] 4.5 Mutation-verify 4.1-4.4 by name (drop the `EXISTS`, pass `SYSTEM_SCOPE` in one path).

## WU4b: Create, assignments, lock scope (PR 4b)

- [x] 5.1 RED `service.test.ts`: `createOrder` accepts 0..n `tecnicoIds`; assignments written in the same tx; deactivated or unknown technician refused with nothing created; zero technicians yields an `open` order with no assignment. GREEN `service.ts`.
- [x] 5.2 RED route tests: POST `/api/service-orders` técnico 403 (`service-orders.create`), jefe 201; create control hidden for técnico. GREEN route, trigger, list page.
- [x] 5.3 RED `order-lock.test.ts`: `scope` option adds the condition; no row for an unassigned técnico throws not-found (404). GREEN `order-lock.ts`; PATCH and transition routes pass the scope.
- [x] 5.4 RED `assignments.test.ts`: admin/jefe assign on `open`/`in_progress` leaves status; `ready_for_review` returns to `in_progress`, new `parte_lista_at` null; duplicate is a no-op; `done`/`cancelled` refused even with correction; técnico 403; deactivated refused; no delete path. GREEN `assignments.ts`, `/api/service-orders/[id]/assignments` POST (guard row `service-orders.assign`).
- [x] 5.5 RED `transitions` tests: técnico `open → in_progress` allowed; técnico to `done`/`cancelled` 403; admin/jefe close from `in_progress`/`ready_for_review`; target `ready_for_review` rejected. GREEN.
- [x] 5.6 RED e2e rows: técnico PATCH/transition on unassigned order 404 and unchanged; assignment idempotence on real SQL; assign during review reopens. GREEN.
- [x] 5.7 Mutation-verify 5.1-5.6 by name.
- [x] 5.8 curl at the LAN IP as técnico, jefe, administrador.

## WU5: Work lines (PR 5)

- [x] 6.1 RED `work-lines.test.ts`: duration 0/-5/1.5/"abc" and blank description refused; `fecha` defaults to local today; técnico only own technician (403) and only in `in_progress`; admin/jefe in `in_progress`/`ready_for_review`; `open` refused; unassigned technician refused; marked técnico refused; edit cannot change technician or order; status read from the locked row. GREEN `work-lines.ts`.
- [x] 6.2 RED correction tests: closed + grant writes `linea_trabajo` add `(null,id)`, delete `(id,null)`, edit `linea_trabajo.<field>`; same tx (audit failure rolls back the line); jefe 403 without verifying password; no password 409; open order writes no audit. GREEN.
- [x] 6.3 RED route tests `/work-lines` POST, `/[lineId]` PATCH/DELETE (+ guard rows); unassigned técnico 404. GREEN routes.
- [x] 6.4 RED e2e `src/e2e/order-work-lines.e2e.test.ts`: composite FK rejects unassigned technician; `SUM(duracion_minutos)` for A in October excludes B and November; correction audit rows exact; throwing audit leaves no line. GREEN.
- [x] 6.5 Mutation-verify 6.1-6.4 by name (audit outside tx, drop the status gate, let edit change `tecnico_id`).

## WU6: Mi parte lista and readiness (PR 6)

- [x] 7.1 RED `readiness.test.ts` truth table: zero active assignees never ready; all active marked becomes `ready_for_review` with timestamp; deactivated unmarked ignored; un-mark returns `in_progress`; only runs in `in_progress`/`ready_for_review`. GREEN `readiness.ts` (`applyReadiness`, no `assertTransition`).
- [x] 7.2 RED `parte-lista.test.ts`: marks only own assignment (403 naming another); refused outside `in_progress`, already marked, closed orders for every role (never correctable); un-mark in `ready_for_review`; no line required. GREEN service, `/parte-lista` POST/DELETE (+ guard rows).
- [x] 7.3 RED e2e race `src/e2e/order-readiness.e2e.test.ts`: second connection holds `FOR UPDATE`; `markParteLista` does not resolve within 300ms, then resolves `ready_for_review`; two simultaneous last marks end `ready_for_review` once. GREEN.
- [x] 7.4 RED admin/jefe `ready_for_review → in_progress` transition. GREEN. Also: a técnico is refused photo add/delete on a `ready_for_review` order (spec); WU1 left `canChangeOrderPhotos` status-only (`ready_for_review: true`), so add the role split here (route/page gate), RED first.
- [x] 7.5 Mutation-verify 7.1-7.4 by name (remove the lock so the race test goes red).
- [x] 7.6 Send-back (`ready_for_review → in_progress` by admin/jefe) clears every assignment's `parte_lista_at` in the same locked transaction, so technicians re-mark after the rework. RED unit in `service.test.ts`, e2e row in `order-readiness.e2e.test.ts`; mutation: drop the clear.

## WU7: Order UI (PR 7)

- [x] 8.1 RED `TechnicianPicker` tests: native checkbox list of ACTIVE technicians only, 44px rows; zero selected submits. GREEN picker in the order form (create) and assignment control on detail with "Técnico asignado" toast.
- [x] 8.2 RED `OrderWorkCard`/`WorkLineDialog` tests: lines, per-technician totals (90/45), marked or pending per assignee; "Mi parte lista" and un-mark only for the viewer's own assignment; toasts "Línea agregada", "Parte marcada como lista"; `inputMode="numeric"`, `<input type="date">`; inline errors; closed order admin sees password field. GREEN.
- [x] 8.3 RED detail/list tests (also reword the PATCH `OrderEditForbiddenError` copy "Solo un administrador puede editar una orden abierta." — a jefe may edit too and `ready_for_review` is not "abierta"; and the bulk `forbidden` copy if the bulk menu ever offers ready_for_review → in_progress): badge and status filter "Lista para revisión" (`VALID_STATUS`); técnico sees no edit control in `ready_for_review`. GREEN `ServiceOrderFilters.tsx`, `service-orders/page.tsx`, detail page.
- [x] 8.4 Mutation-verify 8.1-8.3 by name (show mark to the other technician, list deactivated).
- [x] 8.5 Playwright at `http://192.168.0.3:3000` as tecnico, jefe_taller, administrador at 390/768/desktop: console clean, 44x44 measured, full flow create unassigned, assign, mark, close.

## Spec archive notes

- [ ] 9.1 Archive after `closed-order-lock`: NEW `technicians`, `order-work-lines`; `service-orders` MODIFIES R20, R21, R23, Reception Photos, Order Editing and ADDS Order Assignment, Técnico Scoping; `user-management` ADDS two; `service-order-corrections` ADDS one. Check duplicates after the mechanical apply.
- [ ] 9.2 Follow-ups: WU4b makes `OrderStatusControls` (detail) and `OrderBulkStatusActions` (list) offer a técnico `done`/`cancelled` buttons the route now answers 403 (generic error toast); filtered by `service-orders.assign` in WU7 (8.3, done: `canAssign` prop, `isTransitionPermitted`); malformed JSON on the technician routes answers 500 (same as `/api/users`), guard with a 400;  metrics dashboard, un-assigning, notifications, prices (v2).
