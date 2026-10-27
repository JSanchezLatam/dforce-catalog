# Apply progress: kanban-board

## WU1: Urgent flag (tasks 1.1-1.7) - done

Branch `feat/kanban-board-wu1-urgent`.

- Schema: `urgente_at`, `urgente_by` (FK users, ON DELETE SET NULL) and CHECK `orden_urgente_by_needs_at` on `orden_servicio`; migration `0036_order_urgent.sql` (generated, SQL read by hand).
- `service-orders/urgent.ts#setUrgent`: locks via `lockOrderForMutation` (`canWrite: !isClosedStatus`), writes only the two urgent columns, and writes nothing when the order is already in the requested state.
- `POST`/`DELETE /api/service-orders/[id]/urgent`: `service-orders.assign`; 403 / 404 / 409 `order_closed`. `ROUTE_GUARDS` entry added.
- Eight `OrdenServicio` fixtures gained `urgenteAt: null, urgenteBy: null` (type-only).

Mutations run (each reverted afterwards; failing tests named):
- Closed guard dropped: unit `refuses a done|cancelled order and writes nothing`; e2e `the flag survives the order reaching done|cancelled, ... 409 both ways`.
- Idempotence dropped: unit `is idempotent: setting ... / clearing ...`; e2e `setting an urgent order again succeeds and keeps the first setter and time`.
- `updatedAt` written: unit `sets the flag with the actor and writes ONLY the two urgent columns`; e2e `jefe sets then clears; ... neither moves updatedAt`.
- Actor not recorded: unit `sets the flag with the actor ...`; e2e `jefe sets then clears ...`, `setting an urgent order again ...`.
- Route permission gate dropped: unit `403 for tecnico|pantalla ...`; e2e `a técnico and a pantalla get 403 ...`.
- Route 409 mapping dropped: unit `409 for a closed order, with a Spanish message`; e2e both `the flag survives ...` tests.
- DB CHECK dropped (on `dforce_e2e`): e2e `the database rejects urgente_by set while urgente_at is null`.
- FK changed to NO ACTION (on `dforce_e2e`): e2e `deleting the user who set it nulls urgente_by and keeps the flag` and the column/FK test.

Gates: `npm test` 253 files / 3916 tests; `npx tsc --noEmit` clean (needs the gitignored `next-env.d.ts`, absent from the worktree, else 2 image-import errors in `login/page.tsx`); lint 0 errors / 13 warnings; full e2e on a fresh `dforce_e2e` 32 files / 374 tests.
