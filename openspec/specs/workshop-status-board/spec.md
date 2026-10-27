# Spec: workshop-status-board

Read-only live boards replacing the physical whiteboard. Two views: the full workshop board (`/tablero`) and the waiting-room customer view (`/tablero/clientes`). Scenario tags state how each can be proven: **[unit]** DB-free vitest, **[e2e]** needs real Postgres (anything whose value is a `WHERE`, a constraint or a session row), **[browser]** only provable by opening the app (RSC boundary, rendering at the LAN IP, TV legibility, real expiry behaviour).

## Requirements

### Requirement: Access Matrix per Role

The system MUST define two actions: `board.read` (full board) and `board.customer` (customer view). The matrix MUST be:

| Role | `board.read` / `/tablero` | `board.customer` / `/tablero/clientes` |
|---|---|---|
| `administrador` | allow | allow |
| `jefe_taller` | allow | allow |
| `tecnico` | allow | deny |
| `pantalla` | deny | allow |

Authorization MUST be enforced in the page and in the poll route by `can()`, not by the client. The poll routes MUST be `GET /api/board` (guarded by `board.read`) and `GET /api/board/clientes` (guarded by `board.customer`), and every `page.tsx`/`route.ts` MUST have a `ROUTE_GUARDS` entry. A denied authenticated page request MUST render `PermissionDenied` (not a redirect); a denied authenticated API request MUST be 403 JSON. A request with no valid session MUST redirect pages to `/login` and answer API routes 401 JSON. Neither board view nor poll route MUST contain any control that mutates data; the poll routes MUST accept GET only.

#### Scenario: Pantalla is denied the full board
- GIVEN a `pantalla` session
- WHEN it requests `/tablero`
- THEN the page MUST render `PermissionDenied` and MUST NOT query board data **[unit]**
- AND `GET /api/board` MUST answer 403 **[unit]**

#### Scenario: Técnico reads the full board
- GIVEN a `tecnico` session
- WHEN it requests `/tablero` and `GET /api/board`
- THEN both MUST succeed and the técnico MUST see every order on the board, not only the ones assigned to them **[e2e]**
- AND the page MUST render no button, form or link that mutates data **[unit]**

#### Scenario: Técnico is denied the customer view
- GIVEN a `tecnico` session
- WHEN it requests `/tablero/clientes` or `GET /api/board/clientes`
- THEN the page MUST render `PermissionDenied` and the route MUST answer 403 **[unit]**

#### Scenario: Pantalla reads the customer view
- GIVEN a `pantalla` session
- WHEN it requests `/tablero/clientes` and `GET /api/board/clientes`
- THEN both MUST succeed **[e2e]**

#### Scenario: Administrador and jefe read both views
- GIVEN an `administrador` or a `jefe_taller` session
- WHEN it requests either page or either poll route
- THEN all four MUST succeed **[unit]**

#### Scenario: Unauthenticated
- GIVEN no session, an expired session or a revoked session
- WHEN `/tablero` or `/tablero/clientes` is requested
- THEN the response MUST redirect to `/login` **[e2e]**
- AND `GET /api/board` and `GET /api/board/clientes` MUST answer 401 JSON, not an HTML redirect **[e2e]**

#### Scenario: Guard registry stays complete
- GIVEN the four new files under `src/app/tablero/**` and `src/app/api/board/**`
- WHEN `route-guards.test.ts` runs
- THEN each MUST have an entry quoting its action and methods, and the test MUST fail if one is removed **[unit]**

### Requirement: Full Board Field Whitelist

Each full-board row MUST be built field by field from a named whitelist and MUST contain only: plate, make, model, internal status, hold reason (only while `on_hold`), the names of the ACTIVE assigned technicians (a deactivated technician is never shown), the time in status, and the appointment time (only while `booked`, so an appointment with no vehicle can still be told apart). The board queries MUST NOT join `cliente`, and no row MUST ever carry a customer name, phone, email, portal token, order id, description, findings, recommendations, an appointment time outside `booked`, or internal vehicle fields. A column added to the source tables later MUST NOT appear in a row unless the whitelist is edited.

#### Scenario: Sentinel poison never leaks
- GIVEN source rows whose every `cliente` field and every non-whitelisted order, vehicle and technician field holds a unique sentinel string
- WHEN the full-board mapper builds rows and the poll payload is serialized
- THEN the serialized JSON MUST NOT contain any sentinel **[unit]**
- AND the row keys MUST equal the whitelist exactly **[unit]**

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

### Requirement: Full Board Status Set and Booked Rows

The full board MUST list orders in `booked`, `open`, `diagnosing`, `in_progress`, `on_hold` and `ready_for_review`, plus `done` orders whose `completed_at` falls on the current calendar day in workshop local time. "Today" MUST be computed in `America/Panama` (the zone the `metrics` module already uses), never in the server's or browser's zone. `cancelled` orders MUST NOT appear. Status labels MUST be the ones `ORDER_STATUS_LABEL` defines ("Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada").

A `booked` order may have no vehicle. Its row MUST still appear, showing "Sin vehículo" in place of plate and make/model, its status "Agendada", its appointment time, its technicians and its time in status. A booked order with a vehicle MUST show the vehicle normally.

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

### Requirement: Customer View Field Whitelist and Status Set

The customer view MUST show, per order, only: plate (unmasked), make, model and the customer-facing status. The status label MUST come from the same `CUSTOMER_STATUS` map the QR portal uses (exported from `portal-sync/snapshot.ts`, not copied), so both surfaces say the same thing. The set MUST be the full-board set minus `booked`, with `cancelled` also excluded: `open` ("Recibida"), `diagnosing`, `in_progress`, `on_hold`, `ready_for_review` (all "En proceso") and `done` completed today in `America/Panama` ("Terminada"). Orders with no vehicle MUST NOT appear. Rows MUST NOT carry customer name or phone, order id, hold reason, technicians, time in status, descriptions or any other field, and the query MUST NOT join `cliente`.

#### Scenario: Only four fields
- GIVEN source rows poisoned with sentinels in every other field including `cliente.*`, hold reason and technician names
- WHEN the customer mapper builds rows and the payload is serialized
- THEN the row keys MUST equal exactly plate, make, model and status, and no sentinel MUST appear **[unit]**

#### Scenario: Statuses hidden from the waiting room
- GIVEN one order in each of the eight statuses
- WHEN the customer query runs
- THEN `booked` and `cancelled` orders MUST NOT be returned **[e2e]**

#### Scenario: Labels equal the portal's
- GIVEN each returned status
- WHEN its label is resolved
- THEN it MUST equal `CUSTOMER_STATUS[status]`, and a test MUST fail if the board holds its own copy of the map **[unit]**

#### Scenario: Plate shown unmasked
- GIVEN a vehicle with plate `AB1234`
- WHEN the view renders
- THEN `AB1234` MUST appear in full **[unit]**

### Requirement: Time in Status

The time in status of an order MUST be `now` minus the `changed_at` of the order's latest `orden_estado_historial` row. For an order with no history row (created before the history table existed; it has no backfill), it MUST fall back to the order's `updated_at`. The server MUST compute and send the start timestamp; the client MUST format the elapsed duration, so a screen with a skewed clock is the only one affected. The query MUST resolve "latest" by `changed_at` and MUST NOT count rows of other orders.

#### Scenario: Latest history row wins
- GIVEN an order with history rows at T1 and a later T2
- WHEN the board is queried
- THEN the time in status MUST start at T2 **[e2e]**

#### Scenario: Fallback without history
- GIVEN an order with no history rows and `updated_at` T0
- WHEN the board is queried
- THEN the time in status MUST start at T0 **[e2e]**

#### Scenario: Duration formatting
- GIVEN a start timestamp and a clock
- WHEN the elapsed time is formatted
- THEN under an hour it MUST read in minutes, then hours, then days, and a start in the future MUST read as zero minutes, never negative **[unit]**

### Requirement: Resilient Polling

Both views MUST paint the first snapshot from the server, then a client poller MUST fetch its JSON route every 30 seconds, without pausing for a hidden tab (a TV is always visible), with no overlapping requests. On a failed poll (network error, 5xx, malformed body) the poller MUST keep the last good snapshot on screen and MUST NOT blank, clear or replace it with an error page. While the last poll failed it MUST show a banner reading exactly `Sin conexión · actualizado hace N min`, where N is the whole minutes between the last good snapshot and the LIVE clock (re-evaluated at least every 10 seconds while a failure is current, not only at poll time; minimum 1, singular and plural unchanged, with `·` U+00B7). The banner MUST disappear on the next successful poll. A 401 response MUST navigate to `/login`. A 403 response MUST navigate to `/`, whose role-aware landing decides where the user belongs, and MUST NOT navigate to `/login`. Polling code MUST NOT use any secure-context-only API (`crypto.randomUUID`, `crypto.subtle`, wake lock, service workers, clipboard) because the app is served over plain HTTP on the LAN.

#### Scenario: Failure keeps the snapshot
- GIVEN a rendered snapshot and a poll that rejects
- WHEN the poll fails
- THEN every row MUST remain and the banner `Sin conexión · actualizado hace 1 min` MUST appear once a minute has elapsed since the last good snapshot, at the next clock tick even when the failed polls landed just short of a minute **[unit]**

#### Scenario: Recovery clears the banner
- GIVEN the banner is shown
- WHEN the next poll succeeds with a new snapshot
- THEN the banner MUST disappear and the new rows MUST render **[unit]**

#### Scenario: Unauthorized poll leaves for login
- GIVEN a poll answered 401
- WHEN the poller handles it
- THEN it MUST navigate to `/login` and keep no further timers **[unit]**

#### Scenario: Malformed body is a failure
- GIVEN a 200 response whose body is HTML or lacks the snapshot shape
- WHEN the poller handles it
- THEN it MUST be treated as a failed poll and keep the last snapshot **[unit]**

#### Scenario: Poll route payload
- GIVEN an authorized caller
- WHEN `GET /api/board/clientes` returns
- THEN the body MUST be JSON of the whitelist shape, and a database error MUST yield a JSON 5xx, not an HTML page **[e2e]**

#### Scenario: Real expiry on a screen
- GIVEN a TV logged in as `pantalla` with its session revoked or expired
- WHEN the next poll runs
- THEN the screen MUST land on `/login` instead of showing a dead page **[browser]**

#### Scenario: Server dies and returns
- GIVEN the board open at the LAN IP (`http://<ip>:3000`, from a second machine)
- WHEN the server is stopped for over a minute and restarted
- THEN the last snapshot MUST stay, the banner MUST show, and the board MUST resume without a manual reload **[browser]**

### Requirement: Pantalla Session Lifetime

A session issued to a `pantalla` user MUST expire 180 days after issue; sessions of every other role MUST keep the 7-day lifetime unchanged. The session cookie lifetime MUST follow the issued `expiresAt`. Sessions MUST remain DB-backed so revocation is immediate. Logging in as `pantalla` on one screen MUST NOT revoke the sessions of the same account on other screens.

#### Scenario: Lifetime per role
- GIVEN a `pantalla` user and an `administrador`
- WHEN each logs in
- THEN the `sessions.expires_at` rows MUST be about 180 days and 7 days ahead respectively **[e2e]**

#### Scenario: Two screens stay logged in
- GIVEN a `pantalla` account logged in on screen A
- WHEN it logs in on screen B
- THEN both sessions MUST stay valid **[e2e]**

#### Scenario: Cookie follows expiry
- GIVEN a `pantalla` login
- WHEN the response sets the cookie
- THEN its expiry MUST match the session `expiresAt` **[unit]**

### Requirement: Role-Aware Landing

After login, after the forced password change, and when an authenticated user requests `/`, the destination MUST be `/tablero/clientes` for `pantalla` and `/inventory` for every other role (unchanged). The rule MUST live in one shared function used by all three entry points.

#### Scenario: Landing per role
- GIVEN a `pantalla` and an `administrador` user
- WHEN each logs in, completes a forced password change, or opens `/`
- THEN `pantalla` MUST end on `/tablero/clientes` and the administrador on `/inventory` **[unit]**

#### Scenario: Pantalla never reaches a denied landing
- GIVEN a freshly created `pantalla` account (`mustChangePassword` true)
- WHEN it logs in, changes the password and continues
- THEN it MUST land on `/tablero/clientes` without passing through a `PermissionDenied` page **[e2e]**

### Requirement: Pantalla Has No Application Access

The role `pantalla` MUST be denied every action except `board.customer`: it MUST NOT hold `account.self`, `users.manage`, or any inventory, catalog, customer, vehicle, service-order, technician, metrics or settings action. Every API route other than the customer poll route and the session-only routes (`/api/account/password`, `/api/logout`) MUST therefore answer 403 for `pantalla`; the session-only routes, and the session-only pages `/` and `/change-password`, are deliberately exempt because they are gated by a valid session alone, never by an action (they let the account rotate its forced password, log out and be routed by role). Every page inside the application shell MUST redirect `pantalla` to `/tablero/clientes` before the shell renders, and `/tablero` MUST render `PermissionDenied` inside the chrome-less board layout. `pantalla` MUST NOT see the application sidebar on any page. `can()` MUST fail closed, and order scoping MUST give `pantalla` no orders. The nav MUST offer a link to `/tablero` only to roles holding `board.read`.

#### Scenario: Matrix row is all-false but one
- GIVEN the permission matrix
- WHEN every action is evaluated for `pantalla`
- THEN only `board.customer` MUST be true, and `EDITABLE` MUST hold an all-false row for it **[unit]**

#### Scenario: Other routes denied
- GIVEN a `pantalla` session
- WHEN it requests `/inventory`, `/service-orders`, `/users`, `/account` or `GET /api/users`
- THEN the application layout MUST redirect pages to `/tablero/clientes` before rendering the sidebar shell **[unit]**, the page functions themselves MUST still answer `PermissionDenied` if reached, and APIs MUST answer 403 **[e2e]**

#### Scenario: Session-only routes stay open
- GIVEN the route guard registry
- WHEN `route-guards.test.ts` runs
- THEN `/`, `/change-password`, `/api/account/password` and `/api/logout` MUST be registered `session-only`, never gated by an action, so `pantalla` is not refused on them **[unit]**

#### Scenario: No chrome on the board
- GIVEN a `pantalla` session on `/tablero/clientes`
- WHEN it renders
- THEN no sidebar or navigation MUST be present **[browser]**

#### Scenario: Nav link by role
- GIVEN the nav groups for each role
- WHEN built
- THEN the "Tablero" link to `/tablero` MUST exist for `administrador`, `jefe_taller` and `tecnico` and for no other role **[unit]**

### Requirement: Revocation Kills Big Screens

Deactivating a `pantalla` user, or an administrador resetting its password, MUST revoke all of its sessions, so every screen using the account reaches `/login` on its next poll.

#### Scenario: Password reset revokes
- GIVEN a `pantalla` account logged in on two screens
- WHEN an administrador resets its password
- THEN both sessions MUST have `revoked_at` set and the next poll on each MUST answer 401 **[e2e]**

#### Scenario: Deactivation revokes
- GIVEN the same account
- WHEN an administrador deactivates it
- THEN both sessions MUST be revoked and a login attempt MUST be refused **[e2e]**

### Requirement: Screen Legibility and Rendering

The boards MUST render from a chrome-less layout under `src/app/tablero/**`, readable from across the workshop and waiting room: text and status badges larger than the app's default `text-xs` badge, status distinguishable without relying on color alone. Pages crossing the server/client boundary MUST pass only serializable props.

#### Scenario: Legible on a real screen
- GIVEN each view open on the real TV (or a 1080p display) at the LAN IP
- WHEN viewed from the room's distance
- THEN plate, vehicle and status MUST be readable and no row clipped with a realistic number of orders **[browser]**

#### Scenario: Fixed height and phone width
- GIVEN the customer view with more than 8 orders in a column, or the full board on a 390 px phone
- WHEN rendered
- THEN each customer column MUST show at most 8 rows plus `+N más` so the page fits 1080 px, appointment times MUST render as digits only (`DD/MM HH:mm`, Panama time, identical in Node and browsers), and the full board grid MUST scroll horizontally inside its own container, never the page **[unit]**

#### Scenario: No hydration or RSC errors
- GIVEN each view opened at the LAN IP with real data
- WHEN the browser console is read
- THEN there MUST be no hydration or Server Component serialization error **[browser]**

### Requirement: First Load Survives a Database Outage

When session validation in `src/proxy.ts` throws (database unreachable), the proxy MUST NOT treat it as "no session": it MUST NOT redirect to `/login` and MUST NOT clear or alter the session cookie. For `/api/*` it MUST answer 503 JSON `{ "error": "Service unavailable" }`, so the poller keeps its last snapshot. For pages it MUST answer 503 with a self-refreshing HTML document (`<meta http-equiv="refresh" content="30">`, `lang="es"`, body "Sin conexión, reintentando…"). When the board route segment itself throws, `src/app/tablero/error.tsx` MUST show "Sin conexión, reintentando…" and reload the page after 60 seconds, without relying on `reset()`.

#### Scenario: API request during an outage
- GIVEN a session cookie and a validation call that throws
- WHEN `GET /api/board/clientes` passes through the proxy
- THEN the response MUST be 503 JSON `{ "error": "Service unavailable" }`, neither 401 nor a redirect **[unit]**

#### Scenario: Page request during an outage
- GIVEN a session cookie and a validation call that throws
- WHEN `/tablero/clientes` passes through the proxy
- THEN the response MUST be 503 HTML with a 30-second meta refresh, `lang="es"` and "Sin conexión, reintentando…", and MUST NOT redirect to `/login` and MUST NOT set or clear a cookie **[unit]**

#### Scenario: A screen first-loaded during an outage recovers
- GIVEN a screen opened at the LAN IP while the database is down
- WHEN the database comes back
- THEN the screen MUST show "Sin conexión, reintentando…" and load the board on its own, without a manual reload, and MUST NOT land on `/login` **[browser]** (browser-verified 2026-10-26)
