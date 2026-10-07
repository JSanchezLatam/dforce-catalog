# Design: Technicians, Assignments and Work Lines

## Technical Approach

Three additive tables and two enum values. Every order read and every order write uses ONE scope builder, `orderScope(user)`. It returns a SQL condition: an `EXISTS` over the order's assignments for a técnico, and no condition for a role that holds `service-orders.readAll`. Writes plug that scope into `lockOrderForMutation` (from `closed-order-lock`), so a técnico locking an order they are not assigned to finds no row and gets a 404. Readiness ("Mi parte lista") is recomputed under the same row lock as the mark.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Scoping | `src/modules/service-orders/scope.ts`: `orderScope(user): OrderScope` plus `SYSTEM_SCOPE`. Every order read takes a **required** `scope` argument | An optional viewer, or a per-route `isAssigned` check | A required parameter turns a forgotten read path into a tsc error. An optional one fails open |
| Read paths in scope | `listOrdenesServicio`, `countOrdenesServicio` (via `buildOrdenServicioWhere`), `getOrdenServicioById` (detail, print, PATCH route), the photo GET, the orders read inside `getClienteById` (customer page), `listOrdenesByVehiculo` (vehicle page), the lock | The service-order screens only | The customer and vehicle pages list orders too, and a técnico holds `customers.read` |
| Unassigned access | 404 | 403 | A 403 would confirm that the order exists |
| Who is scoped | New Action `service-orders.readAll` (admin and jefe), exempt in `route-guards.test.ts` the same way `catalogs.listAll` is | Checking `role === "tecnico"` | Follows the precedent `catalogs.listAll` set |
| New Actions | `service-orders.create`, `service-orders.assign`, `technicians.manage` (admin and jefe). Linking a login is evaluated with `users.manage` (admin only) | Reusing `service-orders.write` for create | A técnico keeps `write` and loses only `create` |
| Rule "the line's technician is assigned" | Composite FK `orden_linea_trabajo(orden_id, tecnico_id)` → `orden_tecnico` PK | An app-level check only | A database constraint over app code. Assignments are never deleted, so `restrict` is safe |
| Readiness edges | Manual `ALLOWED_TRANSITIONS` gains only `ready_for_review: ["in_progress","done","cancelled"]` (the `in_progress` edge is admin/jefe only). A técnico may only do `open → in_progress`; `done`/`cancelled` need `service-orders.assign`. The system-only `applyReadiness(tx, orderId)` writes `in_progress⇄ready_for_review` without `assertTransition`. Sending a `ready_for_review` order back to `in_progress` clears every assignment's `parte_lista_at` in the same locked transaction | Letting PATCH `status: ready_for_review` through | Readiness is derived, never chosen. PATCH refuses that status with 400 |
| Roster row for a técnico user | `ensureRosterRow(tx, userId)` runs on `createUser` and on `updateUser` when the role changes to `tecnico`, inside the same transaction | Create only | Otherwise a demoted admin can log in, see nothing, and cannot be assigned |
| Soft delete | `tecnico.deactivated_at` | An `active` boolean | Repository convention |

## Data Model (migrations `0028`, `0029`)

- `tecnico`: `id text pk`, `nombre text not null`, `user_id text unique null → users restrict`, `deactivated_at`, `created_at`.
- `orden_tecnico`: PK `(orden_id, tecnico_id)`, both FKs `restrict`, `parte_lista_at timestamptz null`, `assigned_by → users`, `assigned_at`. Index `(tecnico_id)` for the scope `EXISTS`.
- `orden_linea_trabajo`: `id`, `orden_id`, `tecnico_id` (composite FK above), `descripcion text not null` (max 1000), `duracion_minutos integer not null CHECK (> 0 AND <= 1440)`, `fecha date not null`, `created_by`, timestamps. Indexes `(tecnico_id, fecha)` (metrics: one indexed `SUM`) and `(orden_id)`.

**Enum trap, verified in `node_modules/drizzle-orm/pg-core/dialect.js:60`**: `migrate()` runs ALL pending files in ONE transaction. The workshop applies `0026` through `0029` in a single run, so a separate file provides isolation only through a separate transaction — which does not exist. The rule is therefore: no statement in this change's migrations references `jefe_taller` or `ready_for_review` (no default, no check, no backfill using them). `0028` holds only the two `ALTER TYPE … ADD VALUE` statements (`ALTER TYPE role ADD VALUE 'jefe_taller'`; `ALTER TYPE order_status ADD VALUE 'ready_for_review' BEFORE 'done'`; enum names verified in `schema.ts`). `0029` holds the tables plus a hand-appended backfill: `INSERT INTO tecnico (id, nombre, user_id, deactivated_at, created_at) SELECT gen_random_uuid()::text, coalesce(nullif(btrim(name), ''), username), id, deactivated_at, now() FROM users WHERE role = 'tecnico'` (users columns verified: `name`, `username`, `deactivated_at`; `'tecnico'` is a pre-existing value) (PostgreSQL 17 on both targets). No assignment backfill. Generate both files with drizzle-kit only after `plate-municipio` (0026) and `closed-order-lock` (0027) merge.

## Data Flow

    route: can(action) ─→ service tx {
      lockOrderForMutation(tx, id, { scope: orderScope(user), canWrite, correction? })
        └─ SELECT … WHERE id = $1 AND <scope> FOR UPDATE   (no row → 404)
      write (line / assignment / mark) ─→ applyReadiness(tx, id) ─→ audit if correcting
    } ─→ commit ─→ toast + router.refresh()

`applyReadiness` runs only when the status is `in_progress` or `ready_for_review` AND at least one active (non-deactivated) assignee exists (an order with zero assignees never becomes ready): all active assignments marked → `ready_for_review`, otherwise `in_progress`. A new assignment and an un-mark both pass through it. Sending a `ready_for_review` order back to `in_progress` clears every assignment's `parte_lista_at` so technicians re-mark after the rework. **Race**: two technicians marking at once serialize on the `orden_servicio` row lock, so the second one counts the first one's committed mark. `FOR UPDATE` locks only the FROM table; the `EXISTS` subquery takes no lock.

Work-line permissions: a técnico writes only lines whose `tecnico_id` is their linked row. Admin and jefe write any assigned technician's lines. On a closed order the write is admin-only through `CorrectionGrant`, with audit fields `linea_trabajo` (add `(null,id)`, delete `(id,null)`) and `linea_trabajo.<field>` (edit).

## File Changes

| Area | Files |
|---|---|
| DB | `schema.ts` (enums, 3 tables), `migrations/0028_*.sql`, `0029_*.sql` + `meta/` |
| Auth | `roles.ts` (`jefe_taller`, "Jefe de taller"), `policy.ts` (`MATRIX: Record<Role, Grants>`), `route-guards.test.ts`, `account/service.ts` (role copy, `ensureRosterRow`) |
| Orders | `scope.ts` (new), `queries.ts`, `customers/queries.ts`, `order-lock.ts` (`scope` option), `service.ts` (create with optional `tecnicoIds`, 0..n), `transitions.ts`, `edit-policy.ts` (jefe row, `ready_for_review` column), `statuses.ts`, `StatusBadge.tsx`, `ServiceOrderFilters.tsx`, `service-orders/page.tsx` (`VALID_STATUS`) |
| New modules | `src/modules/technicians/{service,queries}.ts`, `src/modules/service-orders/{assignments,work-lines,readiness}.ts` |
| Routes | `/api/technicians` POST, `/api/technicians/[id]` PATCH (`["technicians.manage","users.manage"]`), `/api/service-orders/[id]/assignments` POST, `/work-lines` POST, `/work-lines/[lineId]` PATCH/DELETE, `/parte-lista` POST/DELETE, `/technicians` page |
| UI | `TechnicianRoster.tsx`, `TechnicianPicker.tsx` (checkbox list), `OrderWorkCard.tsx` (assignees, lines, mark), `WorkLineDialog.tsx`, `nav-items.ts` ("Técnicos" under Configuración, `technicians.manage`) |

## UI

Responsive at 360px first. The roster and work lines render as `RecordCard` stacks on mobile and as tables from `md:` up. The picker is a native checkbox list with full-row 44px labels. "Mi parte lista" is a toggle button (`min-h-11 min-w-11`), shown only to an assigned viewer. Minutes are entered as `inputMode="numeric"`, and the date as `<input type="date">` (a local `YYYY-MM-DD` stored as `date`, so no timezone shift). There is no secure-context API. Every mutation gets a toast with Spanish copy ("Línea agregada", "Parte marcada como lista", "Técnico asignado"), placed above `router.refresh()` and below the try/catch. Jefe navigation: CRM, Catálogo and "Técnicos". The Config. CRM, plantillas and usuarios entries disappear through `can()`.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Matrix rows, `applyReadiness` table, edit-policy exhaustiveness, routes' status codes, each page passes `orderScope(user)` | Fake tx/deps; every fix mutation-verified |
| E2E | **One row per scoped read function** (list, count, detail, photo GET, customer orders, vehicle history, lock): a técnico sees only the assigned order and gets null/404 on the other. Backfill and composite FK violation. `SUM` over the index | Real Postgres `dforce_e2e` |
| E2E race | A second connection holds `FOR UPDATE` on the order; `markParteLista` must NOT resolve within 300ms, then resolves after release with `ready_for_review` | Deterministic, with no test-only seam: removing the lock makes it resolve early (red) |
| Manual | Roster, picker, work card on a tablet and a phone via the LAN IP | Browser |

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Rollout: chained work units (feature-branch chain, 400 lines per PR)

| WU | Scope | Est. |
|---|---|---|
| 1 | Migrations, schema, roles/matrix/route-guards, edit-policy/statuses tsc fallout | ~360 |
| 2 | Roster service + routes + `ensureRosterRow` + e2e | ~350 |
| 3 | Roster UI, user-management role option, nav | ~360 |
| 4a | `scope.ts` + every read path + per-path e2e | ~400 |
| 4b | Create with assignment, `service-orders.create`, lock `scope`, assignments route + e2e | ~330 |
| 5 | Work lines under the lock + routes + correction audit + e2e | ~400 |
| 6 | Readiness, `ready_for_review` transitions, race e2e | ~300 |
| 7 | Order UI: picker, work card, mark, badge/filter | ~400 |

The proposal's WU4 is split in two: seven scoped read paths, each with its own e2e, plus the create flow do not fit in 400 lines. Rollback: revert the chain and drop the tables. Move `ready_for_review` rows to `in_progress` and leave the enum values unused.

## Open Questions

- [x] Can a técnico still move an assigned order to `done`/`cancelled`? RESOLVED (orchestrator, 2026-10-06): no. `service-orders.assign` holders only; a técnico may do `open → in_progress`. The spec pins it (R21).
- [x] Is a technician required at creation? RESOLVED: no. Zero assignments allowed; assigned later.
