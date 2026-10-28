# Design: Kanban Board

## Technical Approach

Most of this already exists, so the board reuses it. It reuses the board read model (`board/queries.ts:22-63`), the poller (`board/useBoardSnapshot.ts:20-70`), the PATCH transition route (`api/service-orders/[id]/route.ts:64-77`) and the state machine (`transitions.ts:48-50`). It adds one flag (two nullable columns plus a dedicated endpoint), one mapper that alone emits `id`, two pure rule modules (`planMove`, `applyOverrides`) and shared presentational primitives that the TV boards reuse. The visual contract is `mockup/index.html`.

## Architecture Decisions

Line references are to this worktree, except `AgendaShell.tsx` and agenda `page.test.tsx`, which exist only on `feat/agenda-redesign`.

| # | Topic | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Urgent storage | `urgente_at timestamptz NULL`, `urgente_by text NULL → users.id ON DELETE SET NULL`. CHECK `orden_urgente_by_needs_at`: `urgente_by IS NULL OR urgente_at IS NOT NULL`. Migration via `npm run db:generate -- --name order_urgent` → `0036_order_urgent.sql` (last is `0035_role_pantalla.sql`). | A boolean; a history table | Nullable timestamp is the repo's soft-flag convention. SET NULL mirrors `createdBy` (`schema.ts:569`). History is out of scope. The CHECK tolerates SET NULL. |
| D2 | Urgent mutation | `POST`/`DELETE /api/service-orders/[id]/urgent`, gated by `service-orders.assign`. Service `setUrgent(id, on, {scope, actorId, db})` in `service-orders/urgent.ts` locks through `lockOrderForMutation` (`order-lock.ts:42-57`) with `canWrite: s => !isClosedStatus(s)`. It writes only the two columns: no `updatedAt`, no portal sync. A POST on an already-urgent order is a no-op. | A PATCH field | PATCH's coarse gate is `service-orders.write`, which the técnico holds (`route.ts:51`), and its field path runs the closed-order correction flow (`route.ts:143-160`). The POST/DELETE mark has precedent in `parte-lista/route.ts:88-96`. `updatedAt` is the `statusSince` fallback (`shape.ts:56`), so touching it would reset ages. |
| D3 | Read model | `boardOrders` also selects `urgenteAt`, `vehiculoId` and `categoria` (`queries.ts:25-34`), and `BoardOrderRow` follows (`shape.ts:17`). The TV `BoardRow` gains only `urgent: boolean`. The new `kanban/shape.ts#toKanbanSnapshot` emits `id`, `categoria`, `missing`, `mine` and `urgent`. | `id` in the TV shape; a second orders query | The TV row whitelist excludes `id` (`shape.test.ts:48,54`). One query keeps a single source for the "today" filter. |
| D4 | Shared row fields | Extract `boardFields(r, techs, sinceById)` from `toBoardSnapshot` (`shape.ts:48-58`). The kanban mapper does `{ id: r.id, ...boardFields(...), categoria, missing, mine }`. | Duplicating the mapping | It spreads a whitelisted object, never a source row, so the rule at `shape.ts:5-6` holds. |
| D5 | `mine` | `kanban/queries.ts#viewerAssignments(userId, ids)`: `tecnico LEFT JOIN orden_tecnico` (scoped to `ids`), filtered on `tecnico.user_id = userId AND tecnico.deactivated_at IS NULL`. It returns `{ onRoster, ordenIds }`. | A per-card subquery | It is one batched query, like `queries.ts:47-60`. `onRoster` hides "Mis órdenes". |
| D6 | Ordering | New pure `board/sort.ts#compareInColumn` (urgent first, then oldest `statusSince`). `shape.ts:61` uses `STATUS_ORDER` diff `‖ compareInColumn`, and the client re-sorts columns after overrides. | Sorting in SQL | The optimistic state must re-sort on the client, and `shape.ts` is server-only (`shape.ts:2-3`). |
| D7 | Rules | `kanban/plan.ts#planMove(card, target, canMove)` returns `noop` (same column or `!canMove`), `illegal`, `incomplete` (`open` with `missing.length`), `ask-reason` (`on_hold`), `confirm` (`done`, `ready_for_review→in_progress`, `cancelled`) or `patch`. `legalTargets(s) = getManualTransitions(s) − cancelled`. Drag and menu both call it. | Rules inside the components | Drag cannot be unit-tested, and the rules can. `getManualTransitions` already runs on the client (`OrderStatusControls.tsx:10`). `ready_for_review→in_progress` wipes readiness marks (`service.ts:492-494`), so it is confirmed. |
| D8 | Optimistic state | `kanban/overrides.ts#applyOverrides(rows, overrides, seq)`: `Map<id, {status?, urgent?, seq}>`. An override applies while it is pending, or until the row matches it, or until 2 good snapshots have arrived since confirmation. `useBoardSnapshot` additively exposes `seq` (good-poll counter) and `refresh()`. | Clearing in an effect; comparing `generatedAt` | Lint forbids `setState` in an effect (`ToastProvider.tsx:64-67`). LAN clocks differ. A poll in flight before the PATCH lands is snapshot #1, so #2 is safe. |
| D9 | Mutation client | `kanban/mutations.ts`: `moveOrder(id, {status, expectedStatus, esperaMotivo?})` returns `{ok, status}` (placed from `orden.status`, since booked→open can land in diagnosing, `service.ts:486-489`). `setUrgent(id, on)`. A 409 `stale_status` maps to "La orden cambió mientras la mirabas. Actualizá el tablero.". Otherwise it uses `errors.form ?? errors.esperaMotivo ?? message`, then generic, then `CONNECTION_ERROR`. On failure it rolls back, with an error toast. On success, toast first, then `refresh()`, both below the try/catch. | Reusing `agenda/patchOrder.ts` | That helper returns no status. The server copy at `service.ts:149` is pinned elsewhere. |
| D10 | Drag | `@dnd-kit/core@6.3.1`, exact pin. `MouseSensor {distance: 5}` and `TouchSensor {delay: 200, tolerance: 5}`. Each card is a draggable and each column a droppable keyed by status. `DragOverlay` sits in the tree (no `createPortal`). | `@dnd-kit/react` 0.x; HTML5 DnD | HTML5 DnD does not fire on touch. |
| D11 | Hydration trap | (a) `DndContext` mounts only once `useSyncExternalStore(subscribeNever, ()=>true, ()=>false)` is true (`ToastProvider.tsx:70`). Before that a static board renders identical markup. (b) Spread `listeners` only, never `attributes`, so no generated `aria-describedby` id and no `role=button`. (c) Phone: `useDraggable({disabled})` from a `(max-width: 767px)` `useSyncExternalStore` (pattern `use-mobile.ts:15-27`). | Trusting dnd-kit SSR ids | Generated ids and the live region are client-only. That is AGENTS.md known limit 2, so a browser check is mandatory. |
| D12 | Menu and sheet | The ⋯ handler reads `window.matchMedia("(min-width: 768px)")` at click time (agenda pattern `AgendaShell.tsx:78`). Wide opens a controlled `DropdownMenu` with a `DropdownMenuSub` "Mover a…" (`dropdown-menu.tsx:99-127`). Narrow opens `Sheet side="bottom"` (`sheet.tsx:39-81`). Both lists come from one `menuItems(card, canMove)`. | Rendering both | There is no viewport on the server. |
| D13 | Phone layout | It stays the same horizontal board: columns are `max-md:w-full` with `scroll-snap`. The tabs `md:hidden` run `scrollTo`, and the active tab follows `onScroll` (an event handler). | Hiding columns; a swipe library | Native snap is the swipe, and there is one DOM. |
| D14 | Tokens | In `globals.css`, `:root`/`.dark` (light and dark, values from mockup lines 33-47): `--board-canvas`, `--board-col`, `--board-tile`, `--board-tile-shadow`, `--urgent`, `--board-warn-bg/-border/-fg`. Matching `--color-*` in `@theme inline`. `@layer components` gets `.board-hue-tile/-bar/-ring/-drop` and `.board-av`, driven by inline `--h/--s`. | Changing existing tokens | This is additive only. Red and amber stay outside the status hues. |
| D15 | Primitives | `board/primitives.tsx` holds `ColumnShell`, `CardShell`, `UrgentBadge`, `TimeChip`, `AlertStrip`, `TechAvatars` (initials plus an sr-only full list), `CategoryTag` and `STATUS_HUE`. No hooks, no `"use client"`, no `button`/`a`. `board/alerts.ts#cardAlert(row, now, missing?)` is pure. | Per-board copies | The TV boards pin "no control" (`WorkshopBoard.test.tsx:106-109`). |

Pinned TV text keeps its own element: technicians "Ana, Beto" in an sr-only span (`WorkshopBoard.test.tsx:97`), ages "12 min"/"3 h"/"2 d" (`:98-100`), hold reason "Repuesto" (`:87`) and appointment "27/10 10:00" (`:64`). Each `section` stays a direct child of the `grid-cols-7` element inside `overflow-x-auto` (`:71-73`). An `on_hold` card shows its age in the alert, not in a chip. `CustomerBoard` keeps `MAX_ROWS=8` and `+N más` (`CustomerBoard.tsx:16,41`).

## Data Flow

    page.tsx ─ kanbanData(user.id) ─┬ workshopBoardData (board/queries.ts)
                                    └ viewerAssignments  (kanban/queries.ts)
         └→ toKanbanSnapshot → <KanbanBoard initial canMove>
    KanbanBoard ─ useBoardSnapshot("/api/kanban") → applyOverrides → columns
       drop / menu → planMove → dialog? → moveOrder (PATCH) → override → toast → refresh()

## File Changes

| File | Action |
|---|---|
| `src/shared/db/schema.ts`, `migrations/0036_order_urgent.sql` (+meta) | Modify / Create (D1) |
| `src/modules/service-orders/urgent.ts` (+test), `src/app/api/service-orders/[id]/urgent/route.ts` (+test) | Create (D2) |
| `src/modules/board/queries.ts`, `shape.ts`, `shape.test.ts`, `sort.ts` | Modify / Create (D3, D4, D6; whitelist test gains `urgent`, poison gains `vehiculoId`/`categoria`) |
| `src/modules/kanban/{queries,shape,plan,overrides,mutations}.ts` (+tests, +`queries.privacy.test.ts`) | Create |
| `src/app/api/kanban/route.ts`, `src/app/(app)/kanban/page.tsx` (+tests) | Create |
| `src/modules/kanban/{KanbanBoard,KanbanCard,CardMenu,MoveSheet,EsperaDialog,ConfirmMoveDialog,IncompleteDialog,DndBoard}.tsx` (+tests, `kanban-safety.test.ts`) | Create |
| `src/modules/board/useBoardSnapshot.ts` | Modify (`seq`, `refresh`) |
| `src/modules/board/{primitives.tsx,alerts.ts}`, `WorkshopBoard.tsx`, `CustomerBoard.tsx` (+tests) | Create / Modify |
| `src/app/globals.css` | Modify (D14) |
| `src/modules/layout/nav-items.ts` (+test), `src/components/app-sidebar.tsx`, `src/modules/auth/route-guards.test.ts` | Modify |
| `package.json` | `@dnd-kit/core` `6.3.1` |

## Interfaces / Contracts

```ts
// BoardRow already carries `urgent` (D3).
type KanbanCard = BoardRow & { id: string; categoria: string | null; missing: ("vehiculo" | "categoria")[]; mine: boolean };
type KanbanSnapshot = { generatedAt: string; onRoster: boolean; rows: KanbanCard[] };
// ROUTE_GUARDS
"/kanban": { GET: "board.read" }, "/api/kanban": { GET: "board.read" },
"/api/service-orders/[id]/urgent": { POST: "service-orders.assign", DELETE: "service-orders.assign" },
```

Nav: `{ href: "/kanban", label: "Kanban", icon: "kanban", action: "board.read" }` goes after Tablero (`nav-items.ts:18`). The arrays at `nav-items.test.ts:34-36` gain "Kanban". KPIs and filter counts come from a pure `kanban/derive.ts` over the displayed rows and `generatedAt`, using `toWorkshopDateKey` (`shared/datetime.ts:64`) and never `Date.now()`.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (node) | `planMove`, `legalTargets`, `applyOverrides` (including the in-flight stale poll), `cardAlert`, `derive`, `compareInColumn`, mappers (exact key sets: no `id`/`missing`/`mine` in `BoardRow`, `id` only in `KanbanCard`), `setUrgent`/route with injected deps | Mutation-verify every rule, and name the revert. |
| jsdom | Board columns and filters, técnico without grip or move items, pantalla PermissionDenied, menu vs sheet (`matchMedia` stub), toasts, rollback, a fake-timer test where a poll does not undo a move, TV pinned tests unchanged, page `assertPlain` (copy from agenda `page.test.tsx:83-90`) | `kanban-safety.test.ts` copies `agenda-safety.test.ts:28-39`, minus the timer ban for the poller file. |
| e2e (fresh `dforce_e2e`) | Migration and CHECK, SET NULL, POST/DELETE urgent with a técnico getting 403 and closed getting 409, `viewerAssignments` (deactivated roster, other technician), new select columns | `src/e2e/{order-urgent,kanban}.e2e.test.ts` |
| Browser at `http://192.168.0.7:3000` | Drag with mouse and tablet long-press, phone sheet, no hydration warning in the console, light and dark, 44 px, `/tablero` with data | Required: no test can see it. |

## Threat Matrix

N/A. The change has no shell, subprocess, VCS, executable-classification or process boundary. Routing is covered by the ROUTE_GUARDS tests.

## Work Units (chained, ≤400 changed lines each)

| WU | Content | Est. |
|---|---|---|
| 1 | D1, D2, e2e | ~300 |
| 2 | D3-D6, `/api/kanban`, guards, nav, TV `urgent` data, e2e | ~350 |
| 3a | Tokens and primitives with tests | ~250 |
| 3b | Read-only `KanbanBoard`, KPIs, filters, phone tabs, page | ~380 |
| 4a | `planMove`, `applyOverrides`, `mutations`, hook `seq`/`refresh` | ~330 |
| 4b | Menu, dialogs, optimistic wiring, toasts | ~400 |
| 5 | Urgent menu item, phone sheet | ~250 |
| 6 | dnd-kit (D10, D11) | ~250 |
| 7 | TV restyle of both boards | ~350 |

My estimate splits proposal WUs 3 and 4: each exceeds 400 lines once tests are counted.

## Migration / Rollout

The migration is additive and nullable, with no backfill. Revert the chain in reverse order, and the columns stay unused.

## Open Questions

- [ ] Toast copy for removing the flag (proposed "Orden ya no es urgente") is left to the spec.
- [x] Confirmed in WU6 (not needed; see apply-progress): confirm at apply time that the `DndContext` `id` prop is not needed once D11a/b are in place.
