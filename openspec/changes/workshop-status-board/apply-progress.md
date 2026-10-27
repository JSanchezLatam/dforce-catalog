# Apply progress: workshop-status-board

## WU1 (branch `feat/workshop-status-board-wu1`) - 1.1-1.10 done, 1.11 partial

### Files changed
- Migration: `src/shared/db/migrations/0035_role_pantalla.sql` (single `ALTER TYPE ... ADD VALUE 'pantalla';`, generated with `npm run db:generate -- --name=role_pantalla`), `meta/_journal.json`, `meta/0035_snapshot.json` (both generated), `src/shared/db/schema.ts`.
- Source: `auth/roles.ts`, `auth/policy.ts` (all-false `pantalla` row, no new Action), `auth/session.ts` (`sessionTtlMs`, `issueSession(userId, role)`), `auth/authenticate.ts`, `auth/landing.ts` (new), `auth/actions.ts`, `app/page.tsx`, `service-orders/edit-policy.ts`, `account/service.ts` (role copy x2).
- Tests: `session`, `authenticate`, `landing` (new), `actions`, `app/page.test.tsx` (new), `policy`, `edit-policy`, `scope`, `roles`, `UserForm`, `UsersTable`, `account/service`, `schema.test.ts` (enum values list updated), `src/e2e/pantalla-role.e2e.test.ts` (new, 9 tests).

### Mutation-verify (reverted fix, named test went red, restored)
- TTL pantalla 180->7: "Lifetime per role - sessionTtlMs() > pantalla gets the lifetime its role calls for"
- landing -> `/inventory`: "Landing per role - landingPathFor() > pantalla lands where its role belongs" and "/ - Landing per role > sends pantalla to /tablero/clientes"
- pantalla cell true: "Matrix row: pantalla is false for every action ..."
- copy dropped in createUser / in updateUser: "Role error copy: rejects an unknown role rather than trusting the caller, in Spanish" / "Role error copy: rejects an unknown role in Spanish, and writes nothing"
- second statement using `'pantalla'` in 0035: e2e "pantalla is a valid role value and a user row with it inserts"
- e2e extras: TTL 7 d -> "session lifetime follows the role ..."; `account.self` granted -> "a forged pantalla is denied every application page and GET /api/users"; reset without revoke and deactivate without revoke -> "deactivation and password reset revoke every session of a pantalla account" (each separately); admin-floor wrapper neutralised -> "with one active administrador and pantalla users ... last_active_admin".

### Gates
- `npm test`: 221 files, 3590 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e (fresh `dforce_e2e`, full suite): 24 files, 320 tests passed, 0 skipped.

### Not done / unchecked
- 1.11 closing steps (GGA, push, PR) left to the orchestrator.
- The spec mentions a role *filter* in the user list; no role filter exists in the code (only selector and badge), so none was touched.
- Pages in e2e (g) are called as functions with forged headers (`next/headers` mocked), not through `proxy.ts`; no browser check (WU4).
- Task 1.3 "order scoping" test passes without code change (pantalla already falls through the technician EXISTS path); it is a regression guard, not a RED.

- WU3 must write the `pantalla` MATRIX row literally when `board.customer` arrives (GGA WU1 note: the `Object.fromEntries` cast disables the missing-grant tsc check).

## WU2 (branch `feat/workshop-status-board-wu2`) - 2.1-2.9 done, 2.10 left to the orchestrator

### Files
- New: `src/modules/board/{format,shape,queries}.ts`, `format.test.ts`, `shape.test.ts`, `queries.privacy.test.ts`, `src/e2e/board.e2e.test.ts`.
- Modified: `src/modules/portal-sync/snapshot.ts` (`export` on `CUSTOMER_STATUS`, one keyword).
- No route, no Action, no UI.

### Behaviour notes
- `formatAge(sinceIso, nowIso)` takes ISO strings (the wire shape). Output follows the task text literally: "hace 12 min" under an hour, then "3 h", then "2 d" (no "hace" on hours/days). Mixed prefix is a copy question for the owner.
- Full-board row keys: `status`, `statusLabel`, `plate`, `make`, `model`, `holdReason` (null unless `on_hold`), `technicians`, `statusSince`; `appointmentAt` exists ONLY while `booked` (null if booked has no appointment). No-vehicle: `plate` = "Sin vehículo", make/model null. Hold-reason label is `ESPERA_MOTIVO_LABEL` ("Repuesto").
- Customer rows: `plate`, `make`, `model`, `status` only; vehicle-less, `booked` and `cancelled` rows are dropped by the mapper as well as by the query.
- Done-today boundary: `toWorkshopDateKey(now)::timestamp AT TIME ZONE 'America/Panama'`, as in metrics/queries.ts. `max(changed_at)` comes back as a `Date` (verified in e2e via `.toISOString()`), so `since as BoardSinceRow[]` only drops the nullable type.
- `queries.ts` avoids the word "cliente" even in comments, because the privacy test is a text match.
- `shape.ts` imports `portal-sync/snapshot` (node:crypto): server-only. WU3 client components must import TYPES from it only.

### Mutation-verify (fix reverted, named test red, restored)
- Panama -> 'UTC' in boundary: e2e "Done yesterday is dropped at Panama midnight: ..."
- `max` -> `min` history: e2e "Latest history row wins, the fallback is updated_at, ..."
- leftJoin -> innerJoin vehiculo: e2e "Booked order without a vehicle is on the full board, ..."
- customer query includes booked: e2e "Statuses included and excluded: ..." and "Booked order without a vehicle ..."
- spread source row in mapper: "Sentinel poison never leaks: ...", "row keys equal the whitelist exactly", "appointmentAt only while booked"
- drop booked-only guard on appointmentAt: "appointmentAt only while booked" and "row keys equal the whitelist exactly"
- drop on_hold guard on hold reason: "Hold reason only while on hold: ..."
- local status map in customer mapper: "the board holds no status map of its own: ..." (source test)
- `import { cliente }` appended to queries.ts: "never mentions the cliente table, its schema export or its columns"
- drop `plate === null` filter: "drops orders with no vehicle"; drop status ordering: "Ordering is stable: ..."

### Gates
- `npm test`: 224 files, 3620 tests passed. `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 13 warnings.
- e2e, fresh `dforce_e2e`, full suite: 25 files, 326 tests passed, 0 skipped (board.e2e: 6 tests).

### Size
- vs `feat/workshop-status-board-wu1` (untracked included): 513 lines (production 142, tests 371; e2e file alone 155). Over 400: pre-agreed escape is shipping `src/e2e/board.e2e.test.ts` as a sub-PR (then 358).

### Unchecked
- The e2e DB zone is UTC (`show timezone`); a non-UTC server/DB zone was not exercised (the boundary is explicit Panama SQL and an Intl date key, so it should not matter, but it was not run).
- "History rows of another order are not counted" is asserted (neighbour with a later row does not change the other order's start) but has no mutation: `groupBy ordenId` cannot be removed without a SQL error.
- Technician batching has no mutation-verify.
- 2.10 (GGA, push, PR) not done.
