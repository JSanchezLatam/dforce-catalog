# Tasks: Kanban Board

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,860 across 10 PRs (tests counted); per-PR 250-400 |
| 400-line budget risk | High (WU4b ~400 and WU3b ~380 sit at the limit) |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3a → WU3b → WU4a → WU4b → WU5 → WU6 → WU7 → WU8 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain (tracker `feat/kanban-board` → main) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Branches: WU1 targets `feat/kanban-board`; each later `feat/kanban-board-wuN-<slug>` targets the previous WU branch. Slugs: `wu1-urgent`, `wu2a-shape`, `wu2b-api`, `wu2c-derive-nav` (WU2 shipped as three PRs), `wu3a-primitives`, `wu3b-board`, `wu4a-plan`, `wu4b-menu`, `wu5-sheet`, `wu6-dnd`, `wu7-tv`, `wu8-signoff`. A child that shows parent changes has the wrong base. Run GGA (`gga run --pr-mode --diff-only`, pin `PR_BASE_BRANCH`) before each PR.

Conventions for every WU: Strict TDD (RED confirmed failing by name, then GREEN); mutation-verify every rule (revert, name the red test); fixtures match the wire; new SQL needs a `dforce_e2e` row (recreate the DB fresh); UI toasts follow `OrderStatusControls.tsx` (toast above `router.refresh()`, below `try/catch`); no secure-context APIs; 44x44 on actions. Gates: `npm test`, `npx tsc --noEmit`, `npm run lint` (0 errors, 13 warnings, no new).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Urgent flag: columns, service, route (~300) | PR 1 → tracker | `npx vitest run src/modules/service-orders/urgent.test.ts "src/app/api/service-orders/[id]/urgent"` | e2e `order-urgent` on fresh `dforce_e2e` | `urgent.ts`, route, migration 0036 (columns stay unused) |
| 2 | Read model, `/api/kanban`, guards, nav, TV `urgent` (~350) | PR 2 → WU1 | `npx vitest run src/modules/board src/modules/kanban src/modules/layout src/modules/auth/route-guards.test.ts` | e2e `kanban` (queries, `mine`, privacy) | `kanban/*` data files, API route, nav entry; `urgent` field is additive |
| 3a | Tokens and primitives (~250) | PR 3 → WU2 | `npx vitest run src/modules/board/primitives.test.tsx src/modules/board/alerts.test.ts` | Browser: tokens light/dark | `globals.css` additions, `primitives.tsx`, `alerts.ts` |
| 3b | Read-only board, KPIs, filters, phone tabs, page (~380) | PR 4 → WU3a | `npx vitest run src/modules/kanban "src/app/(app)/kanban"` | Browser at LAN IP, 4 widths, light+dark | Page and `KanbanBoard*` components |
| 4a | `planMove`, `applyOverrides`, mutations, hook `seq`/`refresh` (~330) | PR 5 → WU3b | `npx vitest run src/modules/kanban/plan.test.ts src/modules/kanban/overrides.test.ts src/modules/kanban/mutations.test.ts src/modules/board/useBoardSnapshot.test.tsx` | N/A: pure logic and a client helper, no UI | Pure modules; hook change is additive |
| 4b | Menu, dialogs, optimistic wiring, toasts (~400) | PR 6 → WU4a | `npx vitest run src/modules/kanban` | Browser: move via menu, rollback, toasts | Menu and dialog components |
| 5 | Urgent menu item, phone sheet (~250) | PR 7 → WU4b | `npx vitest run src/modules/kanban/MoveSheet.test.tsx src/modules/kanban/CardMenu.test.tsx` | Browser at 390: sheet, no drag | `MoveSheet.tsx` and the urgent item |
| 6 | dnd-kit drag (~250) | PR 8 → WU5 | `npx vitest run src/modules/kanban/DndBoard.test.tsx` | Browser: mouse and tablet long-press, console clean | `DndBoard.tsx`, dependency pin |
| 7 | TV restyle of both boards (~350) | PR 9 → WU6 | `npx vitest run src/modules/board` | Browser: `/tablero`, `/tablero/clientes` with data | `WorkshopBoard.tsx`, `CustomerBoard.tsx` |
| 8 | Sign-off, verify, archive (docs only) | PR 10 → WU7 | `npm test && npx tsc --noEmit` | Owner walk-through at LAN IP | Docs and spec merge |

## WU1: Urgent flag (service-orders)

- [x] 1.1 RED e2e `src/e2e/order-urgent.e2e.test.ts`: migration columns exist; CHECK rejects the pair violation; user delete sets `urgente_by` NULL; spec scenarios Jefe sets/clears, Técnico 403, Idempotent set, Survives leaving the board (done and cancelled), Closed order 409.
- [x] 1.2 Reconciled (orchestrator, 2026-10-27): D1 stands; the spec scenario now rejects `urgente_by` set with `urgente_at` NULL, so `ON DELETE SET NULL` keeps the flag.
- [x] 1.3 `src/shared/db/schema.ts`: add both columns and CHECK `orden_urgente_by_needs_at`; `npm run db:generate -- --name order_urgent` → `migrations/0036_order_urgent.sql` (+meta). Check the generated SQL by hand.
- [x] 1.4 RED `src/modules/service-orders/urgent.test.ts` (injected deps): set, clear, idempotent POST (single `urgente_by`), closed → conflict, no `updatedAt` write.
- [x] 1.5 GREEN `src/modules/service-orders/urgent.ts`: `setUrgent(id, on, {scope, actorId, db})` via `lockOrderForMutation` with `canWrite: s => !isClosedStatus(s)`; writes only the two columns.
- [x] 1.6 RED then GREEN `src/app/api/service-orders/[id]/urgent/route.ts` (+test): POST/DELETE gated by `service-orders.assign`; 401, 403 (técnico, pantalla), 404, 409; `ROUTE_GUARDS` entry in `src/modules/auth/route-guards.test.ts`.
- [x] 1.7 Verify: recreate `dforce_e2e`, run the e2e file, mutation-verify 1.5 (drop the closed guard, drop idempotence).

## WU2: Read model, API, guards, nav

- [x] 2.1 RED `src/modules/board/sort.test.ts`; GREEN `board/sort.ts#compareInColumn` (urgent first, then oldest `statusSince`).
- [x] 2.2 RED `board/shape.test.ts`: `BoardRow` key set gains `urgent` only (no `id`/`missing`/`mine`); poison fields `vehiculoId`, `categoria`; urgent-first within status. GREEN `board/queries.ts` (select `urgenteAt`, `vehiculoId`, `categoria`) and `shape.ts` (`boardFields` extract, `urgent`, sort via `compareInColumn`).
- [x] 2.3 RED `kanban/shape.test.ts` (`id` only in `KanbanCard`, `missing`, `mine`, exact keys, sentinel privacy); GREEN `kanban/shape.ts#toKanbanSnapshot`.
- [x] 2.4 RED then GREEN `kanban/queries.ts#viewerAssignments` (+`queries.privacy.test.ts`): `{onRoster, ordenIds}`, deactivated roster row excluded.
- [x] 2.5 RED then GREEN `kanban/derive.ts` (+test): six KPIs and filter counts from displayed rows and `generatedAt` via `toWorkshopDateKey`, never `Date.now()`; filters leave KPIs unchanged.
- [x] 2.6 RED then GREEN `src/app/api/kanban/route.ts` (+test): 401, 403 for pantalla, 200 shape; `ROUTE_GUARDS` `"/kanban"` and `"/api/kanban"` (`board.read`) in `route-guards.test.ts`. Applied: only `"/api/kanban"`; the `"/kanban"` entry moves to 3b.3 because the completeness test requires the page file to exist.
- [x] 2.7 RED then GREEN `layout/nav-items.ts` (+test arrays at `:34-36` gain "Kanban" after "Tablero", absent for pantalla); `src/components/app-sidebar.tsx` icon `kanban`.
- [x] 2.8 e2e `src/e2e/kanban.e2e.test.ts` (fresh DB): new select columns, `mine` per viewer (A true, B false), deactivated roster, other technician, no customer sentinel, técnico PATCH refused, `/api/board` clean.
- [x] 2.9 Verify: unit suite, e2e, mutation-verify `mine` filter and `compareInColumn`.

## WU3a: Tokens and primitives

- [x] 3a.1 `src/app/globals.css`: `--board-canvas/-col/-tile/-tile-shadow`, `--urgent`, `--board-warn-*` in `:root` and `.dark` (mockup lines 33-47), `--color-*` in `@theme inline`, `.board-hue-tile/-bar/-ring/-drop`, `.board-av`. Additive only; read current file first.
- [x] 3a.2 RED `board/alerts.test.ts`; GREEN `board/alerts.ts#cardAlert(row, now, missing?)`: "Cita vencida · hace 1 h 10 min", "Repuesto · hace 3 días", "Falta vehículo y categoría"; none for a long `in_progress` card.
- [x] 3a.3 RED `board/primitives.test.tsx` (no `button`/`a`, no hooks; "Sin placa", "Sin vehículo", "Sin técnico", sr-only full tech names, Urgente badge icon + text); GREEN `board/primitives.tsx` (`ColumnShell`, `CardShell`, `UrgentBadge`, `TimeChip`, `AlertStrip`, `TechAvatars`, `CategoryTag`, `STATUS_HUE`).
- [x] 3a.4 Verify: unit, mutation-verify alert reasons and primitives. The browser check (tokens render in light and dark) is deferred to WU3b: no page renders the primitives until then.

## WU3b: Read-only board and page

- [x] 3b.1 RED `kanban/KanbanBoard.test.tsx`: seven columns in order, no Cancelada, "Completada" via snapshot, urgent first, "Sin órdenes" and "Ninguna orden tuya en este estado", "Columnas anteriores"/"Columnas siguientes", six KPIs, chips with `aria-pressed`, "Mis órdenes" absent without roster, "Asignada a vos", "Solo lectura" for técnico, "Actualizado hace N s", "Sin conexión · actualizado hace N min", phone tabs with counts.
- [x] 3b.2 GREEN `kanban/KanbanBoard.tsx` + `KanbanCard.tsx` (read-only; ⋯ button 44x44 may be a stub linking "Ver orden"); poll via `useBoardSnapshot("/api/kanban")`; phone tabs `md:hidden` with `scrollTo`, `max-md:w-full` scroll-snap columns.
- [x] 3b.3 RED then GREEN `src/app/(app)/kanban/page.tsx` (+test, `assertPlain` copied from agenda `page.test.tsx:83-90`): pantalla → `PermissionDenied` without querying; serializable props only; `canMove` from `service-orders.assign`.
- [x] 3b.4 RED then GREEN `kanban/kanban-safety.test.ts` (copy `agenda-safety.test.ts:28-39`; timer ban exempts the poller file).
- [x] 3b.5 Verified by the orchestrator 2026-10-27 on a :3001 dev server over the `dforce_catalog_kb` copy: jefe at 1440/1024/768/390 light+dark and técnico at 1440 render all seven columns, no console errors or hydration warnings, no page horizontal scroll, no visible control under 44x44; pantalla is redirected away.
- [ ] 3b.6 Restore the approved-mockup details WU3b cut for size, before WU8 sign-off: KPI sub-captions, right-edge scroller fade, coloured tile on phone tabs, phone "Actualizar" button (needs `refresh` from 4a.4), a ticking "Actualizado hace N s", time chip "hace 1 día" (not "hace 1 d"), and the "Arrastrá una tarjeta…" subtitle once WU6 ships drag.

## WU4a: Move rules and client state

- [x] 4a.1 RED `kanban/plan.test.ts`: `noop`, `illegal`, `incomplete`, `ask-reason`, `confirm` (done, `ready_for_review→in_progress`, cancelled), `patch`; `legalTargets` excludes `cancelled`, `diagnosing`, `ready_for_review`. GREEN `kanban/plan.ts`.
- [x] 4a.2 RED `kanban/overrides.test.ts`: in-flight stale poll kept, dropped when row matches, dropped after 2 good snapshots, urgent override. GREEN `kanban/overrides.ts#applyOverrides`.
- [x] 4a.3 RED `kanban/mutations.test.ts` (wire-shaped fixtures): `moveOrder` returns `{ok, status}` from `orden.status`; 409 `stale_status` → "La orden cambió mientras la mirabas. Actualizá el tablero."; `errors.form ?? errors.esperaMotivo ?? message`; network → `CONNECTION_ERROR`; `setUrgent`. GREEN `kanban/mutations.ts`.
- [x] 4a.4 RED then GREEN `board/useBoardSnapshot.ts`: additive `seq` and `refresh()`; existing TV tests unchanged; fake-timer cadence still one request per 30 s.
- [x] 4a.5 Verify: unit; mutation-verify each plan branch and the 2-snapshot rule.

## WU4b: Menu, dialogs, optimistic wiring

- [x] 4b.1 RED `kanban/CardMenu.test.tsx`: "Acciones de la orden", "Mover a…" with submenu "Mover <placa> a…" (absent without legal targets), "Ver orden", "Cancelar orden" danger; técnico sees only "Ver orden"; wide vs narrow via `matchMedia` stub read at click time. GREEN `kanban/CardMenu.tsx` with `menuItems(card, canMove)`.
- [x] 4b.2 RED then GREEN `EsperaDialog.tsx` ("¿Por qué queda en espera?", "Repuesto"/"Falta que llegue una pieza", "Aprobación del cliente"/"El cliente tiene que aprobar el trabajo", "Pasar a En espera" disabled until chosen), `ConfirmMoveDialog.tsx` ("¿Marcar la orden como Completada?", "Sí, completar", "Cancelar"; ready_for_review→in_progress; cancel order), `IncompleteDialog.tsx` ("Todavía no se puede recibir", "Completá el vehículo y la categoría antes de recibir la orden", "sin cargar", "Cerrar", "Editar orden").
- [x] 4b.3 RED then GREEN wiring in `KanbanBoard.tsx`: `planMove` → dialog → `moveOrder`; optimistic override; toast "Orden movida a <estado>" above `router.refresh()`, below `try/catch`; stale rollback; server-placed card (booked→diagnosing); dismissed dialog sends nothing; fake-timer poll-during-move test.
- [x] 4b.4 Verified by the orchestrator 2026-10-27 at :3001 (dforce_catalog_kb, seed customer orders `kanbancheck-*` only): menu rows 44px, submenu lists only legal targets, En espera reason required, ready_for_review→in_progress confirm, 409 from a second tab rolls back with the stale copy, cancel confirm removes the card; no hydration warnings. Cancel toast changed to "Orden cancelada" (mutation-verified).

## WU5: Urgent item and phone sheet

- [x] 5.1 RED then GREEN "Marcar como urgente"/"Quitar urgente" in `CardMenu.tsx` (gated by `canMove`): optimistic badge, sort first, toasts "Orden marcada como urgente" / "Orden desmarcada como urgente", rollback with error toast.
- [x] 5.2 RED `kanban/MoveSheet.test.tsx`: narrow viewport opens `Sheet side="bottom"` headed by plate and status; "Mover a" group of legal targets, urgent toggle, "Ver orden", "Cancelar orden"; rows 44x44; no draggable on phone. GREEN `kanban/MoveSheet.tsx`, sharing `menuItems`.
- [x] 5.3 Verified by the orchestrator 2026-10-27 at :3001 on seed-customer order `kanbancheck-3`: at 390 (dark and light) ⋯ opens the bottom sheet (rows and "Cerrar" 44px, closes on choose, toast "Orden marcada como urgente", POST persisted); at 1440 ⋯ opens the dropdown with "Quitar urgente" (toast "Orden desmarcada como urgente", DELETE persisted); no page horizontal scroll, no hydration warnings.

## WU6: Drag and drop

- [x] 6.1 `package.json`: `@dnd-kit/core` exact `6.3.1`; confirm `npm ls` and lockfile.
- [x] 6.2 RED `kanban/DndBoard.test.tsx`: legal columns highlighted and others dimmed "No se puede mover acá" for an `in_progress` card; illegal drop does nothing; técnico has no grip; phone `disabled`; board renders identical static markup before mount (D11a). GREEN `kanban/DndBoard.tsx` (`MouseSensor {distance: 5}`, `TouchSensor {delay: 200, tolerance: 5}`, `listeners` only, no `attributes`, no `createPortal`, mount via `useSyncExternalStore`).
- [x] 6.3 Wire drop → `planMove` (same path as menu). Resolve open question: is `DndContext` `id` needed?
- [x] 6.4 Verified by the orchestrator 2026-10-27 at :3001: jefe at 1440 dark and light — dragging an `in_progress` card by its 44x44 grip lights En espera and Completada and dims the other five with "No se puede mover acá"; the in-tree overlay follows the pointer; a drop on En espera opens the reason dialog; a drop on Recibida does nothing; técnico and 390 show no visible grip; at 768 a horizontal swipe on a card body still scrolls the columns (scrollLeft 0→292); no hydration warnings or serialization errors. Mutation log for the legality check is in apply-progress.md.

## WU7: TV restyle

- [x] 7.1 RED `WorkshopBoard.test.tsx`: existing pinned asserts unchanged ("Ana, Beto" sr-only, "12 min"/"3 h"/"2 d", "Repuesto", "27/10 10:00", `section` direct child of `grid-cols-7`, no control); add Urgente badge and no "falta categoría". GREEN restyle `board/WorkshopBoard.tsx` with primitives; `on_hold` age in the alert.
- [x] 7.2 RED then GREEN `board/CustomerBoard.tsx`: `MAX_ROWS=8` and `+N más` kept, four fields only, key set unchanged.
- [x] 7.3 Verified by the orchestrator 2026-10-27 at :3001: `/tablero` (jefe) and `/tablero/clientes` (pantalla) at 1920x1080 and 390, light and dark: all columns render, zero buttons or links, urgent cards show the red badge and edge, the hold reason strip and the overdue-appointment strip appear only with a reason, the customer board caps at 8 with "+9 más" and shows only plate, vehicle and status; no page horizontal scroll; no console errors.

## WU8: Sign-off, verify, archive

- [ ] 8.1 Owner walk-through at http://192.168.0.7:3000 from a second machine: roles administrador, jefe_taller, tecnico, pantalla; desktop, tablet, phone, light and dark. Record result.
- [ ] 8.2 Full gates: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:portal-sync` not needed; e2e files on fresh `dforce_e2e`.
- [ ] 8.3 `sdd-verify`, then merge the chain into the tracker in order and the tracker into main.
- [ ] 8.4 `sdd-archive`: merge deltas into `openspec/specs/` (kanban-board new; service-orders and workshop-status-board MODIFIED); add a "Kanban" note to `AGENTS.md` only if a new standing decision emerged.

## Follow-ups

- A move started right after an urgent toggle replaces the card's single override, so the badge can revert for up to two polls (WU5 note). Merge override fields per card if it shows in use.
- "Mis órdenes" stays applied if a poll flips `onRoster` to false while the chip is hidden (GGA note on WU3b).
- `order-urgent.e2e.test.ts` builds every request as POST, including clears; pass the method (GGA note on WU1). (out of scope)

- Toggle Urgente from the order detail page (not mocked).
- Urgent-flag history trail (latest who/when only).
- Generalize the server `stale_status` copy (`service.ts:149`).
- Time-based urgency, per-column targets, average wait.
- Clean the 13 pre-existing lint warnings (separate change).
