# Proposal: Technicians, Assignments and Work Lines

## Intent

Orders have no notion of WHO works them: `createdBy` is the only person column, every `tecnico` user sees and edits every order, and nothing records time spent. Round 2 step 3 (owner grill 2026-10-03/06): a technician roster, a `jefe_taller` role, orders assigned to 1+ technicians, per-technician work lines and "Mi parte lista", so the workshop knows who did what and how long it took. It also lays the data `metrics-dashboard` needs.

## Scope

### In Scope
- `tecnico` table (name, active, OPTIONAL unique link to `users`); backfill one row per existing `tecnico`-role user (1 today).
- `jefe_taller` role: admin grants minus `users.manage`, `workshop.edit`, `template.edit`, `service-orders.correct`.
- `orden_tecnico` assignment (order, tecnico, `parte_lista_at`); never deleted (FK `restrict`, no delete path).
- Admin/jefe create orders and assign; técnico cannot create, and sees/edits ONLY assigned orders (list, detail, print, photos, transitions, PATCH).
- `orden_linea_trabajo`: description, tecnico, `duracion_minutos` integer > 0, `fecha`; index `(tecnico_id, fecha)`. No prices.
- "Mi parte lista": all assigned marked → new status `ready_for_review` ("Lista para revisión"); admin/jefe may close from `in_progress` or `ready_for_review` regardless.
- Every work-line write goes through `lockOrderForMutation`; on a closed order it is an admin correction, audited.
- Responsive tablet/mobile, Spanish copy, success toast per mutation, 44px targets, no secure-context API.

### Out of Scope
- Prices/quotes (v2); metrics dashboard; un-assigning; technician self-service roster edits; notifications.

## Capabilities

### New Capabilities
- `technicians`: roster, optional login link, backfill, who manages it.
- `order-work-lines`: work lines, "Mi parte lista", readiness rule.

### Modified Capabilities
- `service-orders`: creation restricted to admin/jefe with assignment; assignment-scoped visibility and editing gate (adds `jefe_taller`); lifecycle adds `ready_for_review`.
- `user-management`: `jefe_taller` assignable; a new `tecnico` user gets a linked roster row.
- `service-order-corrections` (once `closed-order-lock` archives): work-line corrections audited.

## Approach

Additive migration `0028` (after `plate-municipio` 0026 and `closed-order-lock` 0027). Enum values added in their own migration file (`ALTER TYPE … ADD VALUE` is unusable in the same transaction). Scoping lives in one service predicate `isAssigned(user, orderId)` used by queries and the lock's `canWrite`, not per route. Readiness is recomputed inside the same locked transaction as the mark.

Estimate ~2,500 changed lines, feature-branch chain (400/PR):

| WU | Scope | Est. |
|---|---|---|
| 1 | Migrations (enums, 3 tables, backfill), schema, roles/policy/route-guards | ~380 |
| 2 | Roster service + routes + e2e | ~350 |
| 3 | Roster UI (admin/jefe), user-management role + auto-link | ~380 |
| 4 | Assignment on create, técnico create refusal, assignment-scoped queries/gate, e2e | ~400 |
| 5 | Work lines service under the lock + routes + e2e | ~400 |
| 6 | "Mi parte lista" + `ready_for_review` transitions + e2e | ~300 |
| 7 | Order UI: assignees, work lines, mark, status badge/filter | ~400 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scoping missed on one read path leaks orders | Med | Single predicate; e2e per path; route-guards test |
| Injected-seam blind spot on `WHERE`/backfill | High | e2e rows mandatory |
| Migration renumber vs siblings | Med | Generate only after `closed-order-lock` merges |
| Existing técnico sees zero orders after rollout | High | Question 1 |

## Rollback Plan

Revert the chain. Tables are additive (drop). Enum values cannot be dropped in Postgres: leave them unused, or recreate the type if `ready_for_review` rows exist (move them to `in_progress` first).

## Dependencies

- Ships AFTER `closed-order-lock` merges (needs `lockOrderForMutation`, migration 0027).

## Success Criteria

- [ ] Técnico sees only assigned orders on every read path and cannot create (e2e).
- [ ] Last "Mi parte lista" moves the order to `ready_for_review`; admin/jefe close anytime.
- [ ] Jefe gets 403 on users and settings.
- [ ] Hours per technician per month = one indexed `SUM(duracion_minutos)`.

## Proposal question round

Assumptions needing owner review (auto mode):
1. The 8 existing orders get NO backfilled assignment; the one técnico sees none until reassigned. Alternative: assign all non-closed orders to them.
2. A técnico may un-mark "Mi parte lista" while the order is open; that returns `ready_for_review` → `in_progress`.
3. Assigning a technician to a `ready_for_review` order returns it to `in_progress`.
4. A work line's technician must be assigned to the order; a técnico writes only their own lines.
5. Admin and jefe manage the roster; linking a roster row to a login is admin-only.
6. `jefe_taller` keeps `sync.manual` and `catalogs.generate`.
