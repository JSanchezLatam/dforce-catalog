# Spec: kanban-board

## Purpose

An in-app board at `/kanban` (Taller group) where orders sit in one column per status and administrador / jefe_taller move them. Visual contract (archived): `openspec/changes/archive/2026-10-28-kanban-board/mockup/index.html` (approved 2026-10-27). UI strings are Spanish exactly as quoted; everything else is English. Tags: **[unit]** DB-free, **[e2e]** real Postgres, **[browser]** only provable in a browser at the LAN IP.

## Requirements

### Requirement: Access and Navigation

The system MUST gate viewing with `board.read` and moving or flagging with `service-orders.assign`. `/kanban` and `GET /api/kanban` MUST have `ROUTE_GUARDS` entries. The matrix MUST be:

| Role | View | Move / toggle Urgente |
|---|---|---|
| `administrador` | allow | allow |
| `jefe_taller` | allow | allow |
| `tecnico` | allow, read-only | deny |
| `pantalla` | deny | deny |

A denied authenticated page request MUST render `PermissionDenied`; a denied API request MUST be 403 JSON; no session MUST redirect pages to `/login` and answer API 401 JSON. The Taller nav group MUST list "Kanban" (`/kanban`) directly below "Tablero" for roles holding `board.read`, and for no other role. Enforcement MUST be server-side, never only by hiding controls.

#### Scenario: Pantalla is refused
- GIVEN a `pantalla` session
- WHEN it requests `/kanban` and `GET /api/kanban`
- THEN the page MUST render `PermissionDenied` without querying board data, and the API MUST answer 403 **[unit]**

#### Scenario: Técnico is read-only
- GIVEN a `tecnico` session
- WHEN `/kanban` renders
- THEN the heading MUST carry the "Solo lectura" badge, no card MUST show a drag grip, and the ⋯ menu MUST offer only "Ver orden" **[unit]**
- AND a PATCH of an order status by that técnico MUST be refused by the server **[e2e]**

#### Scenario: Nav entry by role
- GIVEN the nav built for each role
- WHEN rendered
- THEN "Kanban" MUST follow "Tablero" for administrador, jefe_taller and tecnico, and be absent for pantalla **[unit]**

### Requirement: Board Layout and Columns

The board MUST show one column per status in this order: "Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada" (labels from `ORDER_STATUS_LABEL`). `cancelled` MUST have no column. "Completada" MUST list only orders completed today in `America/Panama`. Each column MUST show its title, an icon and a count of its visible cards; an empty column MUST read "Sin órdenes" (for a técnico filtered to "Mis órdenes": "Ninguna orden tuya en este estado"). On desktop and tablet the columns MUST scroll horizontally inside their own container, with controls labelled "Columnas anteriores" and "Columnas siguientes" and scroll-snap, never scrolling the page. Within a column, urgent cards MUST sort first, then the board's existing order. The page MUST show how fresh the last snapshot is: "Actualizado hace menos de 30 s" while polls succeed (a ticking second count would need an always-on timer on every board), and the real age ("Sin conexión · actualizado hace N min") while a poll is failing.

#### Scenario: Seven columns, no Cancelada
- GIVEN orders in all eight statuses
- WHEN the board renders
- THEN exactly seven columns MUST exist in the order above and no cancelled order MUST appear **[unit]**

#### Scenario: Urgent first
- GIVEN a column holding a non-urgent card older than an urgent one
- WHEN it renders
- THEN the urgent card MUST be first **[unit]**

### Requirement: Card Content and Color Rules

A card MUST show plate ("Sin placa" when none), vehicle ("Sin vehículo" when none), a neutral category tag, technicians as initials avatars (each with the full name as accessible text; "Sin técnico" when none), and a neutral time chip: time in status, or the appointment time for `booked`. A card MUST NOT show any customer name, phone or email. A card whose viewer is assigned MUST show "Asignada a vos". Red MUST be used only for the Urgente flag (red "Urgente" badge with an icon plus a left stripe); the time chip MUST never turn red or amber. Amber alert strips MUST appear only for a concrete reason, each with an icon and text: an appointment already passed ("Cita vencida · hace 1 h 10 min"), `on_hold` ("<motivo> · hace 3 días", motivo "Repuesto" or "Aprobación del cliente"), or a missing vehicle or category ("Falta vehículo y categoría"). Status MUST never depend on color alone.

#### Scenario: No customer data
- GIVEN source rows whose customer fields hold sentinel strings
- WHEN `GET /api/kanban` is serialized
- THEN no sentinel MUST appear **[unit]** and a database-backed call MUST be clean too **[e2e]**

#### Scenario: Amber only for a reason
- GIVEN a long-running `in_progress` card with a vehicle and a category
- WHEN it renders
- THEN it MUST show no amber strip and a neutral time chip **[unit]**

#### Scenario: On-hold strip
- GIVEN an `on_hold` order with reason `repuesto` held 3 days
- WHEN it renders
- THEN the strip MUST read "Repuesto · hace 3 días" **[unit]**

### Requirement: Kanban Payload Whitelist

`GET /api/kanban` MUST be built by a dedicated mapper, field by field, emitting only: id, status, plate, make, model, category, hold reason (only while `on_hold`), active technician names, status-since timestamp, appointment time (only while `booked`), `missing` (which of vehicle / category are absent), `mine` (viewer is an assigned active technician) and `urgent`. The order `id`, `missing` and `mine` MUST NOT be added to the `/api/board` or `/api/board/clientes` payloads.

#### Scenario: Id stays off the TV payloads
- GIVEN the same source rows
- WHEN the TV mappers and the kanban mapper run
- THEN only the kanban rows MUST contain `id` **[unit]**

#### Scenario: Mine is per viewer
- GIVEN an order assigned to technician A
- WHEN A and then B request the payload
- THEN `mine` MUST be true for A and false for B **[e2e]**

### Requirement: KPIs and Filters

A strip MUST show six KPIs in this order: "En el taller", "Urgentes", "En espera", "Completadas hoy", "Agendadas hoy", "Citas vencidas". Their values MUST be the same for every role. Filter chips with counts MUST be "Todas", "Mis órdenes", "Urgentes", "En espera", each with `aria-pressed`. "Mis órdenes" MUST be shown only when the viewer has an active technician roster row. Filters MUST narrow the cards but MUST NOT change the KPIs. No average wait and no per-column target MUST appear.

#### Scenario: Filter narrows cards only
- GIVEN 15 orders of which 2 are urgent
- WHEN the viewer selects "Urgentes"
- THEN only the 2 urgent cards MUST show and "En el taller" MUST be unchanged **[unit]**

#### Scenario: No roster, no chip
- GIVEN a jefe_taller with no technician roster row
- WHEN the board renders
- THEN "Mis órdenes" MUST be absent **[unit]**

### Requirement: Move Rules

A move MUST be planned by one pure function used by drag, menu and phone sheet alike. A target is legal only if it is in `getManualTransitions(card.status)` and differs from the current column. `diagnosing` and `ready_for_review` MUST never be a manual target; `done` and `open` offer no onward move from the board beyond what `getManualTransitions` allows. During a drag, legal columns MUST light up with their own color and every other column except the origin MUST be dimmed with a hint that depends on BOTH the origin status and the target column: when the target is in the transition table for the origin AND is automatic, the hint is "Pasa sola al asignar un técnico" (target `diagnosing`) or "Pasa sola cuando todos marcan su parte lista" (target `ready_for_review`); otherwise it is "Desde <estado origen> no se puede pasar a <estado destino>" using the Spanish status labels. The hint is rendered by one pure function shared by the dimmed column and the drop toast. Dropping on an illegal column MUST send no request and MUST show an info toast with the same text as that column's hint followed by a period. Dropping on the origin column MUST do nothing and show no toast. "Mover a…" MUST list only legal targets and be absent when none exist. A move to "En espera" MUST ask the reason with two options, "Repuesto" ("Falta que llegue una pieza") and "Aprobación del cliente" ("El cliente tiene que aprobar el trabajo"), under the title "¿Por qué queda en espera?", and the confirm button "Pasar a En espera" MUST stay disabled until one is chosen. A move to "Completada" MUST ask "¿Marcar la orden como Completada?" (confirm "Sí, completar", dismiss "Cancelar"). A move from "Lista para revisión" to "En progreso" MUST ask for confirmation before calling the server. "Cancelar orden" MUST exist only in the card menu, MUST ask for confirmation, and MUST never be a drop target.
(Previously: every dimmed column read "No se puede mover acá" regardless of origin, and dropping on an illegal column did nothing silently.)

#### Scenario: Legal and illegal targets
- GIVEN an `in_progress` card
- WHEN a drag starts
- THEN "En espera" and "Completada" MUST be highlighted **[unit]**
- AND "En diagnóstico" MUST be dimmed with "Desde En progreso no se puede pasar a En diagnóstico" **[unit]**
- AND "Lista para revisión" MUST be dimmed with "Pasa sola cuando todos marcan su parte lista" **[unit]**

#### Scenario: Recibida dragged over En diagnóstico **[unit]**
- GIVEN an `open` card
- WHEN a drag starts
- THEN "En diagnóstico" MUST be dimmed with "Pasa sola al asignar un técnico" and "En progreso" with "Desde Recibida no se puede pasar a En progreso"

#### Scenario: Same target, different origin **[unit]**
- GIVEN a `booked` card
- WHEN a drag starts
- THEN "En diagnóstico" MUST be dimmed with "Desde Agendada no se puede pasar a En diagnóstico", not "Pasa sola al asignar un técnico"

#### Scenario: Automatic review target from another origin **[unit]**
- GIVEN a `diagnosing` card
- WHEN a drag starts
- THEN "Lista para revisión" MUST be dimmed with "Desde En diagnóstico no se puede pasar a Lista para revisión"

#### Scenario: Illegal drop explains itself **[unit]**
- GIVEN an `open` card being dragged
- WHEN it is dropped on "En diagnóstico"
- THEN no request MUST be sent, the card MUST stay, and an info toast "Pasa sola al asignar un técnico." MUST show

#### Scenario: Illegal drop from another origin **[unit]**
- GIVEN a `booked` card dropped on "En diagnóstico"
- WHEN the drop lands
- THEN no request MUST be sent and the toast "Desde Agendada no se puede pasar a En diagnóstico." MUST show

#### Scenario: Drop on own column is silent **[unit]**
- GIVEN any card dropped on its own column
- WHEN the drop lands
- THEN no request and no toast MUST result

#### Scenario: The old generic text is gone **[unit]**
- GIVEN any drag
- WHEN dimmed columns render
- THEN no element MUST read "No se puede mover acá"

#### Scenario: Hold needs a reason
- GIVEN a drop on "En espera"
- WHEN the dialog opens
- THEN "Pasar a En espera" MUST be disabled until a reason is picked, and the PATCH MUST carry that reason **[unit]**

#### Scenario: Complete is confirmed
- GIVEN a drop on "Completada"
- WHEN the operator dismisses with "Cancelar"
- THEN no request MUST be sent and the card MUST stay **[unit]**

#### Scenario: Recibida refused when incomplete
- GIVEN a `booked` card whose `missing` is non-empty
- WHEN the operator moves it to "Recibida"
- THEN no request MUST be sent, and a dialog titled "Todavía no se puede recibir" MUST read "Completá el vehículo y la categoría antes de recibir la orden", list "Vehículo" and "Categoría" as "sin cargar" as applicable, and offer "Cerrar" and "Editar orden" (a link to the order) **[unit]**

#### Scenario: Drop hint placement and legibility **[browser]**
- GIVEN a drag in progress at 1280px and 768px
- WHEN the dimmed columns render
- THEN each hint MUST be fully readable inside its column (not clipped, text wrapping within the column width) and the dimmed card content MUST stay dimmed

### Requirement: Persisting a Move

A move MUST send PATCH `{ status, esperaMotivo?, expectedStatus: <the card's status> }` and apply the change optimistically. The card MUST be placed in the column of the status the response returns (a received order with a technician may land in "En diagnóstico"). On success it MUST show the toast "Orden movida a <estado>" (label of the returned status), or "Orden cancelada" when the order was cancelled (the app-wide cancel copy), above the board refresh and below the `try/catch`. The board refreshes through its own poller (`useBoardSnapshot().refresh()`), not `router.refresh()`, because the poller owns the rendered snapshot. On 409 `stale_status` the card MUST return to its place and an error toast MUST read exactly "La orden cambió mientras la mirabas. Actualizá el tablero."; on any other failure (400, 403, network) it MUST roll back and show the server's Spanish message, or a generic Spanish one. A poll arriving during an in-flight move MUST NOT revert the optimistic card; the override MUST be dropped once a snapshot carries the new status.

#### Scenario: Successful move
- GIVEN an `in_progress` card dropped on "En espera" with a reason
- WHEN the server accepts
- THEN the card MUST sit in "En espera" and the toast "Orden movida a En espera" MUST show **[unit]**

#### Scenario: Stale move rolls back
- GIVEN a card another user already moved
- WHEN the server answers 409 `stale_status`
- THEN the card MUST return to its original column and the stale-status toast MUST show **[unit]**

#### Scenario: Server places the card
- GIVEN a `booked` card with a technician moved to "Recibida"
- WHEN the response says `diagnosing`
- THEN the card MUST appear in "En diagnóstico" **[unit]**

#### Scenario: Poll during a move
- GIVEN a PATCH in flight and a poll answering with the old status
- WHEN the poll lands
- THEN the card MUST stay in the optimistic column **[unit]**

### Requirement: Card Menu and Urgent Toggle

Every card MUST have a 44x44 button "Acciones de la orden" opening a menu: "Mover a…" (submenu "Mover <placa> a…"), "Marcar como urgente" or "Quitar urgente" (administrador and jefe_taller only), "Ver orden", and "Cancelar orden" (danger style, gated like moves). Marking MUST toast "Orden marcada como urgente"; clearing MUST toast "Orden desmarcada como urgente". The menu MUST be reachable by keyboard and screen reader. When the card is `open` (so "Mover a…" is absent because `legalTargets("open")` is empty) and the viewer may move cards (administrador, jefe_taller), the menu MUST begin with a disabled, `aria-disabled` item with an info icon reading "Para pasarla a En diagnóstico, asigná un técnico.", followed by a separator; the phone sheet (`MoveSheet`) MUST show the same text as a non-actionable row first, and keep its `Trash2` on "Cancelar orden". The item MUST NOT be focus-activatable and MUST NOT appear for any other status or for a técnico.
(Previously: an `open` card's menu silently lacked "Mover a…".)

#### Scenario: Toggle by role
- GIVEN an urgent card
- WHEN a jefe_taller opens its menu, then a técnico does
- THEN the jefe MUST see "Quitar urgente" and the técnico MUST see only "Ver orden" **[unit]**

#### Scenario: Mark urgent
- GIVEN a non-urgent card
- WHEN a jefe chooses "Marcar como urgente" and the server accepts
- THEN the card MUST show the "Urgente" badge, sort first, and the toast MUST show **[unit]**

#### Scenario: Recibida menu explains the missing move **[unit]**
- GIVEN an `open` card and a jefe_taller
- WHEN the menu opens
- THEN its first item MUST be disabled and read "Para pasarla a En diagnóstico, asigná un técnico.", "Mover a…" MUST be absent, and "Marcar como urgente", "Ver orden" and "Cancelar orden" MUST remain

#### Scenario: Disabled item does nothing **[unit]**
- GIVEN that menu
- WHEN the operator activates the disabled item
- THEN no request MUST be sent and the menu MUST stay open

#### Scenario: Phone sheet carries the same reason **[unit]**
- GIVEN an `open` card on a phone viewport and an administrador
- WHEN the sheet opens
- THEN its first row MUST read "Para pasarla a En diagnóstico, asigná un técnico." and "Cancelar orden" MUST still be offered

#### Scenario: Other statuses and roles get no reason item **[unit]**
- GIVEN a `booked` card for a jefe, and an `open` card for a técnico
- WHEN each menu opens
- THEN neither MUST contain "Para pasarla a En diagnóstico, asigná un técnico."

#### Scenario: Blocked row hit target and wrap **[browser]**
- GIVEN the Recibida menu and the sheet at tablet and phone widths, light and dark
- WHEN rendered
- THEN the text MUST wrap inside the menu (max 280px) without clipping, and the row MUST measure at least 44px tall

### Requirement: Live Updates

The page MUST paint the first snapshot from the server, then poll `/api/kanban` every 30 seconds without overlap, keeping the last snapshot on failure and showing `Sin conexión · actualizado hace N min`. A 401 MUST navigate to `/login`; a 403 to `/`. A manual "Actualizar" control (phone) MUST refetch. Polling and drag code MUST NOT use secure-context-only APIs (`crypto.randomUUID`, `crypto.subtle`, clipboard, service workers) since the app is served over plain HTTP on the LAN.

#### Scenario: Cadence
- GIVEN fake timers
- WHEN 30 s elapse
- THEN exactly one request to `/api/kanban` MUST be made **[unit]**

#### Scenario: Insecure context
- GIVEN the board opened at `http://<lan-ip>:3000` on another machine
- WHEN it loads, drags and polls
- THEN no console error, hydration mismatch or Server Component serialization error MUST appear **[browser]**

### Requirement: Touch, Tablet and Phone

On touch, a drag MUST start only after a ~200 ms long press (tolerance ~5 px) so horizontal scroll keeps working. Every action control (⋯, filter chips, tabs, scroll arrows, dialog buttons, sheet rows) MUST be at least 44x44 px. On a phone viewport there MUST be no drag: one column at a time with status tabs showing counts, a swipeable list, a KPI row that scrolls sideways, and "⋯" opening a bottom sheet headed by the plate and status, with a "Mover a" group of legal targets, then the urgent toggle, "Ver orden" and "Cancelar orden". The page itself MUST never scroll sideways.

#### Scenario: Phone has no drag
- GIVEN a 390 px viewport
- WHEN a card's ⋯ is tapped
- THEN a bottom sheet MUST open listing legal targets and no card MUST be draggable **[unit]**

#### Scenario: Hit targets
- GIVEN the board at tablet and phone widths
- WHEN measured in a browser
- THEN each action control MUST be at least 44x44 px in light and dark themes **[browser]**
