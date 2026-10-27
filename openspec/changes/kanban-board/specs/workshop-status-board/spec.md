# Delta for workshop-status-board

## MODIFIED Requirements

### Requirement: Full Board Field Whitelist

Each full-board row MUST be built field by field from a named whitelist and MUST contain only: plate, make, model, internal status, hold reason (only while `on_hold`), the names of the ACTIVE assigned technicians (a deactivated technician is never shown), the time in status, the appointment time (only while `booked`, so an appointment with no vehicle can still be told apart), and `urgent` (boolean, true when the manual Urgente flag is set). The board queries MUST NOT join `cliente`, and no row MUST ever carry a customer name, phone, email, portal token, order id, description, findings, recommendations, an appointment time outside `booked`, the kanban-only `missing` and `mine` fields, or internal vehicle fields. A column added to the source tables later MUST NOT appear in a row unless the whitelist is edited.
(Previously: the whitelist had no `urgent` field.)

#### Scenario: Sentinel poison never leaks
- GIVEN source rows whose every `cliente` field and every non-whitelisted order, vehicle and technician field holds a unique sentinel string
- WHEN the full-board mapper builds rows and the poll payload is serialized
- THEN the serialized JSON MUST NOT contain any sentinel **[unit]**
- AND the row keys MUST equal the whitelist exactly, including `urgent` and excluding `id`, `missing` and `mine` **[unit]**

#### Scenario: Customer data seeded, board payload clean
- GIVEN a real database whose orders belong to a customer named with a sentinel and a sentinel phone
- WHEN `GET /api/board` is called by an `administrador`
- THEN the body MUST NOT contain the sentinel name or phone **[e2e]**

#### Scenario: Deactivated technician is off the board
- GIVEN an order assigned to one active and one deactivated technician
- WHEN the full-board query runs
- THEN the row MUST list only the active technician's name **[e2e]**

#### Scenario: Hold reason only while on hold
- GIVEN an `on_hold` order with reason `repuesto` and an `in_progress` order
- WHEN the board is built
- THEN the first row MUST show the Spanish hold-reason label and the second MUST carry no hold reason **[unit]**

#### Scenario: Urgent flag reaches the row
- GIVEN one order with the Urgente flag set and one without
- WHEN the board is built
- THEN the first row MUST have `urgent` true, the second false, and neither MUST carry the flagging user or timestamp **[unit]**

### Requirement: Full Board Status Set and Booked Rows

The full board MUST list orders in `booked`, `open`, `diagnosing`, `in_progress`, `on_hold` and `ready_for_review`, plus `done` orders whose `completed_at` falls on the current calendar day in workshop local time. "Today" MUST be computed in `America/Panama` (the zone the `metrics` module already uses), never in the server's or browser's zone. `cancelled` orders MUST NOT appear. Status labels MUST be the ones `ORDER_STATUS_LABEL` defines ("Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada").

A `booked` order may have no vehicle. Its row MUST still appear, showing "Sin vehículo" in place of plate and make/model, its status "Agendada", its appointment time, its technicians and its time in status. A booked order with a vehicle MUST show the vehicle normally.

Rows MUST be grouped by status in the order listed above; within a status, urgent rows MUST come first, then the longest time in status first. An urgent row MUST show a red "Urgente" badge with an icon and text, never color alone.
(Previously: within a status only the longest time in status first; no urgent badge.)

#### Scenario: Statuses included and excluded
- GIVEN one order in each of the eight statuses, the `done` one completed today
- WHEN the full-board query runs
- THEN exactly the seven non-cancelled orders MUST be returned **[e2e]**

#### Scenario: Done yesterday is dropped at Panama midnight
- GIVEN a `done` order with `completed_at` of 23:30 Panama time yesterday and another at 00:30 Panama time today
- WHEN the query runs at 09:00 Panama time
- THEN only the second MUST be returned, including when the database session or server zone is UTC **[e2e]**

#### Scenario: Booked order without a vehicle
- GIVEN a `booked` order with null vehicle and one technician assigned
- WHEN the board is built
- THEN its row MUST show "Sin vehículo", "Agendada" and the technician name, and the build MUST NOT throw **[unit]**

#### Scenario: Ordering is stable
- GIVEN several orders
- WHEN the board is built
- THEN rows MUST be grouped by status in the order listed above and, within a status, the longest time in status first **[unit]**

#### Scenario: Urgent first within a status
- GIVEN two `in_progress` orders where the older is not urgent and the newer is
- WHEN the board is built
- THEN the urgent row MUST precede the older one **[unit]**

#### Scenario: Urgent badge on the TV
- GIVEN an urgent row
- WHEN `/tablero` renders
- THEN the badge "Urgente" MUST be present, the board MUST show no "falta categoría" alert, and no control MUST be rendered **[unit]**

### Requirement: Screen Legibility and Rendering

The boards MUST render from a chrome-less layout under `src/app/tablero/**`, readable from across the workshop and waiting room: text and status badges larger than the app's default `text-xs` badge, status distinguishable without relying on color alone. Both boards MUST adopt the kanban look (rounded status-colored columns with icon, title and count; cards with initials avatars; neutral time chips; amber strips only for a concrete reason; red only for Urgente) in light and dark, while keeping every structure already pinned: one heading and one region per column, one list item per card, no mutating control, and technician names available as accessible text (initials are visual only). Pages crossing the server/client boundary MUST pass only serializable props.
(Previously: no required visual language beyond legibility and non-color-only status.)

#### Scenario: Legible on a real screen
- GIVEN each view open on the real TV (or a 1080p display) at the LAN IP
- WHEN viewed from the room's distance
- THEN plate, vehicle and status MUST be readable and no row clipped with a realistic number of orders **[browser]**

#### Scenario: Fixed height and phone width
- GIVEN the customer view with more than 8 orders in a column, or the full board on a 390 px phone
- WHEN rendered
- THEN each customer column MUST show at most 8 rows plus `+N más` so the page fits 1080 px, appointment times MUST render as digits only (`DD/MM HH:mm`, Panama time, identical in Node and browsers), and the full board grid MUST scroll horizontally inside its own container, never the page **[unit]**

#### Scenario: Technicians as avatars, names kept
- GIVEN a row with technicians "Ana" and "Beto"
- WHEN the full board renders
- THEN initials MUST show visually and the full names MUST remain in the accessible text **[unit]**

#### Scenario: Customer view keeps its four fields
- GIVEN the restyled customer view
- WHEN rendered and its payload serialized
- THEN each card MUST show only plate, vehicle and customer-facing status, and the row keys MUST still equal plate, make, model and status **[unit]**

#### Scenario: No hydration or RSC errors
- GIVEN each view opened at the LAN IP with real data
- WHEN the browser console is read
- THEN there MUST be no hydration or Server Component serialization error **[browser]**
