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

## WU2: Read model, API, guards, nav (tasks 2.1-2.9) - done

Branch `feat/kanban-board-wu2-read-model`.

- `board/sort.ts#compareInColumn`; `board/queries.ts` also selects `urgenteAt`, `vehiculoId`, `categoria`; `board/shape.ts` extracts `boardFields`, adds `urgent` to `BoardRow` and sorts through `compareRows` (status order, then `compareInColumn`).
- `kanban/shape.ts#toKanbanSnapshot` (only mapper emitting `id`, `categoria`, `missing`, `mine`), `kanban/queries.ts` (`viewerAssignments`, `kanbanData`), `kanban/derive.ts` (`deriveBoard`, `filterCards`), `GET /api/kanban` (`board.read`), "Kanban" nav entry below "Tablero" with a `Columns3` icon.
- Deviation: the `"/kanban"` ROUTE_GUARDS entry is NOT added here (task 2.6 said both). The completeness test requires the page file to exist, so the entry lands with the page in 3b.3. Until then the nav link points at a 404.
- KPI definitions (not in the spec text, chosen here): "En el taller" = open, diagnosing, in_progress, on_hold, ready_for_review; "Completadas hoy" = done with `statusSince` on today's Panama day; "Agendadas hoy" = booked with an appointment on today's Panama day; "Citas vencidas" = booked with an appointment before `generatedAt` (any day); "Urgentes" = displayed urgent cards.
- 401 is the proxy's job (the handler reads identity headers), as for `/api/board`; no handler-level 401 test.
- `viewerAssignments`'s `IN (ids)` scoping on the join is not observable from output (an assignment outside the board never flags a card), so it has no mutation test; it only bounds the query.

Mutations run (each reverted; failing tests named, all in the apply report).
Gates: `npm test` 258 files / 3946 tests; `npx tsc --noEmit` clean; lint 0 errors / 13 warnings; full e2e on a fresh `dforce_e2e` 33 files / 381 tests.
