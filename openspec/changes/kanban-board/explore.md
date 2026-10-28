# Exploration: kanban-board

Date: 2026-10-26. Owner decisions (final): a kanban of service orders that works like one (drag a card between status columns), as a separate in-app view in the "Taller" group; only administrador and jefe_taller move cards, técnico sees it read-only, pantalla never. The TV views (`/tablero`, `/tablero/clientes`) stay read-only but adopt the same aesthetic. Reference: a "Patient Flow" kanban — rounded columns with title and count, white cards with an initials avatar, a time-in-status chip colored by urgency, an in-card amber alert, a KPI strip and filter chips.

## Current state

- **Deps:** react/react-dom 19.2.4, next 16.2.11, `@base-ui/react`; no drag-and-drop library. `src/components/ui/` has dropdown-menu, dialog, avatar, sheet, card.
- **Transitions** (`service-orders/transitions.ts`): `ALLOWED_TRANSITIONS` private (29-38); `AUTOMATIC_TARGETS` = diagnosing, ready_for_review (45); `getManualTransitions(from)` exported (48-50) — enough for drop legality. `cancelled` has no column: menu only.
- **Board data** (`board/queries.ts`): `boardOrders` selects id, status, esperaMotivo, updatedAt, appointmentAt, plate/make/model (left join), never `cliente`; `workshopBoardData` adds active technicians and the history "since". `board/shape.ts` treats `id` as a join key that never leaves (16) and builds fields by name; no vehicle/category presence, no id.
- **Polling:** `useBoardSnapshot` (20-70) polls every 30 s, no overlap, keeps the last snapshot, 401 → /login, 403 → /; no setter or manual refresh.
- **PATCH route** (`api/service-orders/[id]/route.ts`): `expectedStatus` validated (64-67), passed to `transitionOrder` (68-77); errors: 403 forbidden (183-188), 409 `stale_status` (189-191), 400 invalid_transition (192-194), 400 esperaMotivo (195-197), 400 incomplete order (201-203). Receiving a booked order with a technician lands in `diagnosing` (`service.ts:486-489`), so the client must place the card from the response. The stale copy says "Actualizá la agenda" (`service.ts:149`), pinned in four test files and two specs.
- **Permissions:** `board.read` true for técnico/jefe/admin, false for pantalla; `service-orders.assign` only jefe/admin. A técnico PATCH is already refused server-side.
- **Nav:** Taller group (`nav-items.ts:17-23`, pinned by `nav-items.test.ts:34-36`); "Tablero" already means the TV board.
- **Theme:** `layout.tsx:25` `defaultTheme="dark"`, `enableSystem={false}`.
- **TV components and their pinned tests:** `WorkshopBoard` 7 columns in `min-w-[72rem] grid-cols-7` inside `overflow-x-auto`; `CustomerBoard` 3 columns, `MAX_ROWS = 8` with `+N más`; tests pin one `h2` and `region` per column, one `li` per card, no controls, the text "Ana, Beto", the ages, the polled URLs, and source-text bans. Spec constraints: no mutating control (18), whitelist without id or customer data (60), status not by color alone (269), 8-row cap and scroll container (279).

## Options

| Topic | Options | Recommendation |
|---|---|---|
| Drag and drop | `@dnd-kit/core` 6.3.1 (React ≥16.8, mouse/touch/pointer sensors) / `@dnd-kit/react` 0.5 (pre-1.0) / hand-rolled pointer events / menu only | `@dnd-kit/core` with Mouse + Touch (delay ~200 ms, tolerance 5) sensors, plus a "Mover a…" menu shipped first as the touch/keyboard/screen-reader path. Native HTML5 DnD does not fire on touch. |
| Data shape | board rows + 2 columns and a separate kanban mapper/route / add `id` to the TV shape / new query | reuse `workshopBoardData` (+ `vehiculoId`, `categoria`), a new `kanban/shape.ts` that alone emits `id`, `/api/kanban`. Adding `id` to the TV shape breaks spec line 60. |

## Recommendation

1. Kanban card fields: id, status, plate, make, model, holdReason, technicians, statusSince, appointmentAt (booked only), `missing` (vehiculo/categoria), `mine` (assigned to the viewer; one extra query joining `orden_tecnico` → `tecnico.user_id`, needs an e2e). No customer name or phone for anyone, matching the board decision.
2. Live updates: poll `/api/kanban` every 30 s; optimistic override by id on drop; PATCH `{ status, esperaMotivo?, expectedStatus: card.status }`; place from `orden.status`; roll back with the message on 409/400/403; drop the override once a newer snapshot carries the status. The client maps `stale_status` to "La orden cambió mientras la mirabas. Actualizá el tablero." (generalizing the server copy is a follow-up).
3. Drop rules: legal target = in `getManualTransitions(card.status)` and not the same column; others dimmed and refused; En espera asks the reason (two 44 px buttons); Completada and Lista para revisión → En progreso ask for confirmation; cancel only from the menu, with confirmation; Recibida refused client-side when `missing` is non-empty, with "Completá el vehículo y la categoría antes de recibir la orden" and an "Editar orden" link.
4. KPIs: En el taller, Urgentes, En espera, Completadas hoy, Agendadas hoy, Citas vencidas. No average wait, no per-column target.
5. Urgency is a manual flag, not a time rule (owner decision 2026-10-27). administrador and jefe_taller toggle "Urgente" on a card or on the order; it stores who and when (new nullable columns on `orden_servicio`, e.g. `urgente_at` + `urgente_by`, needs a migration and e2e). An urgent card shows a red "Urgente" badge and sorts first in its column; técnico sees it read-only. The time-in-status chip is informational: neutral ("hace 5 h"), amber only for a concrete reason (appointment passed, En espera with its reason and age, missing vehículo/categoría), never red on its own. Red is reserved for the manual flag. Icon + text, not color alone.
6. Filter chips with counts: Todas, Mis órdenes (hidden without a roster row), Urgentes, En espera.
7. TV restyle through shared presentational primitives (column shell, card, avatar, time chip, alert) with semantic tokens for light and dark; keep every pinned structure; technician names move to avatars with `aria-label`/sr-only text; the customer board keeps plate, vehicle and status with a vehicle icon.
8. Route and policy: no new action. `board.read` gates viewing, `canMove = can(user, "service-orders.assign")` gates drag and menu; `/kanban` labelled "Kanban"; ROUTE_GUARDS entries for `/kanban` and `/api/kanban`.

## Work units (~1,700 lines)

| WU | Content | Est. |
|---|---|---|
| 1 | Query columns, `kanban/shape.ts` (mapper, KPIs, urgency), `mine` query, `/api/kanban`, guards, nav | ~300 |
| 2 | Shared card primitives, read-only `KanbanBoard` with KPIs and filters, page | ~380 |
| 3 | `planMove`, "Mover a…" menu, En espera dialog, confirmations, optimistic PATCH, toast, hook refresh | ~400 |
| 4 | `@dnd-kit/core`, sensors, dimmed columns, drag overlay | ~250 |
| 5 | TV restyle of both boards | ~350 |

## Risks

- dnd-kit's live region and drag overlay use a portal and generated ids (the project's hydration trap); touch long-press vs horizontal scroll; both only visible in a browser at the LAN IP.
- Drag is not unit-testable: cover through pure `planMove` with mutation-verified rules.
- New SQL (`mine`, two columns) needs e2e.
- `id` and `missing` must never reach the TV mappers (key-equality test + a new no-id assertion).
- Optimistic flicker from an in-flight poll (fake-timer test).
- "Tablero" vs "Kanban" naming.

## Open questions for the owner

1. ~~Urgency thresholds~~ — resolved 2026-10-27: manual "Urgente" flag (item 5); no per-column target.
2. Label "Kanban" at `/kanban`.
3. Confirmation on Completada and on "Devolver a En progreso".
