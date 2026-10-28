# Spec: workshop-agenda

One staff-only `/agenda` page that replaces the physical appointment board: day, week, month and combined views over booked and in-flight orders, an overdue ("Vencida") rule, an appointment Detail (popover or bottom sheet) carrying the Reprogramar and "No se presentó" actions, "Todas / Agendadas / Vencidas" tabs, search and type filter, a side column (mini calendar, next appointment, week summary), and a slim booking dialog with quick customer create. It reads existing order data and writes only through the existing order and customer APIs (no new write API, no migration).

Scenario tags: **[unit]** DB-free vitest; **[e2e]** needs real Postgres (anything whose value is a `WHERE`, a time-zone boundary, or a permission on the real path); **[browser]** only provable by opening the app (hydration, RSC boundary, 44px targets, phone/tablet layout, LAN IP).

Terms. "Panama day" = calendar day in `America/Panama` (UTC-5, no DST). "Appointment" = an `orden_servicio` with a non-null `appointment_at`. Status labels are the ones `ORDER_STATUS_LABEL` defines ("Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada", "Cancelada"). "In-workshop" statuses = `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`.

Terms added by `agenda-redesign`. Visual contract (archived): `openspec/changes/archive/2026-10-28-agenda-redesign/mockup/index.html`; where the mockup draws a control under 44 px (phone chips `min-h-9`, type chips `min-h-9`, month "+N más" `min-h-7`), the 44x44 rule of AGENTS.md wins. "Type" = `categoria` (`instalacion` "Instalación", `mant_preventivo` "Mant. Preventivo", `mant_correctivo` "Mant. Correctivo", `reparacion` "Reparación", `revisado` "REVISADO"; null = "Sin categoría"; labels and placeholder come from `categoriaLabel` in `service-orders/categories.ts`, the one every surface reads). "No-show" = an order whose current status is `cancelled`, that has a `booked → cancelled` history row, and whose `appointment_at` is earlier than that row's timestamp. "Loaded range" = the appointments the range query returned for the visible range. "Detail" = the popover (md and wider) or bottom sheet (below md) of one appointment. Weekday and month names in any client file come from static Spanish tables, never from `Intl` or `toLocale*`.

## Requirements

### Requirement: Agenda Access

The system MUST define the action `agenda.manage`, allowed for `administrador` and `jefe_taller` and denied for `tecnico` and `pantalla`. `/agenda` (page at `src/app/(app)/agenda/`) MUST check `can(user, "agenda.manage")` in the page itself and MUST have a `ROUTE_GUARDS` entry. A denied authenticated request MUST render `PermissionDenied` (not a redirect) and MUST NOT query agenda data. A request with no valid session MUST redirect to `/login`. For `pantalla` the application layout MUST redirect to `/tablero/clientes` before the page renders (existing behaviour of the `(app)` shell; the page function itself still answers `PermissionDenied` if reached). The sidebar MUST show an "Agenda" link to `/agenda`, in the "Taller" group, only to roles holding `agenda.manage`. The agenda MUST add no new API route: its writes go through `PATCH /api/service-orders/[id]`, `POST /api/service-orders`, `POST /api/service-orders/[id]/assignments` and `POST /api/customers`, whose own permission checks are unchanged. A detail control backed by a permission the user lacks (for example assigning a technician without `service-orders.assign`) MUST NOT render.

#### Scenario: Matrix row per role
- GIVEN the permission matrix
- WHEN `agenda.manage` is evaluated for each role
- THEN it MUST be true for `administrador` and `jefe_taller` and false for `tecnico` and `pantalla` **[unit]**

#### Scenario: Técnico is denied
- GIVEN a `tecnico` session
- WHEN it requests `/agenda`
- THEN the page MUST render `PermissionDenied` and MUST NOT call any agenda query **[unit]**

#### Scenario: Pantalla never sees the agenda
- GIVEN a `pantalla` session
- WHEN it requests `/agenda`
- THEN the application layout MUST redirect it to `/tablero/clientes` **[unit]**
- AND the page function, if invoked directly, MUST answer `PermissionDenied` **[unit]**

#### Scenario: Unauthenticated
- GIVEN no, an expired or a revoked session
- WHEN `/agenda` is requested
- THEN the response MUST redirect to `/login` **[e2e]**

#### Scenario: Administrador and jefe read the agenda
- GIVEN an `administrador` or a `jefe_taller` session
- WHEN it requests `/agenda`
- THEN the page MUST render with data **[e2e]**

#### Scenario: Nav link by role
- GIVEN the nav groups built for each role
- WHEN they are inspected
- THEN an "Agenda" link to `/agenda` MUST exist for `administrador` and `jefe_taller` and for no other role **[unit]**

#### Scenario: Guard registry stays complete
- GIVEN `src/app/(app)/agenda/page.tsx`
- WHEN `route-guards.test.ts` runs
- THEN it MUST find a `ROUTE_GUARDS` entry quoting `agenda.manage` and a literal `can(user, "agenda.manage")` in the page, and MUST fail if either is removed **[unit]**

#### Scenario: No new route
- GIVEN `src/app/api/`
- WHEN the route tree is compared with `main`
- THEN no route file MUST have been added by this change **[unit]**

#### Scenario: Assign control follows the permission
- GIVEN a user without `service-orders.assign`
- WHEN a booked appointment's detail renders
- THEN "+ Asignar técnico" MUST NOT render **[unit]**

### Requirement: Agenda URL, View and Date Parameters

The page MUST be addressed as `/agenda?view=day|week|month|combined&date=YYYY-MM-DD`. A missing or invalid `view` (any value outside the four) MUST fall back to `week`. A missing or invalid `date` (not `YYYY-MM-DD`, or not a real calendar date such as `2026-02-30`) MUST fall back to today's Panama day. Invalid parameters MUST NOT produce an error page or a 500. Weeks MUST start on Monday. Navigation (previous, next, "Hoy", switching view) MUST be plain links that rewrite the query string; the selected day MUST survive a view switch. "Previous/next" MUST step one day in `day` and `combined`, one week in `week`, one month in `month`.

#### Scenario: Defaults
- GIVEN `/agenda` with no query string, requested at 22:30 Panama time on a day that is already the next day in UTC
- WHEN the params are resolved
- THEN `view` MUST be `week` and `date` MUST be the Panama day, not the UTC day **[unit]**

#### Scenario: Invalid params fall back
- GIVEN `view=year` and `date=2026-13-45` (and separately `date=abc`, `date=2026-02-30`)
- WHEN the params are resolved
- THEN `view` MUST be `week` and `date` today's Panama day, with no exception **[unit]**

#### Scenario: Week starts Monday
- GIVEN `date=2026-10-25` (a Sunday)
- WHEN the week view resolves its range
- THEN the first day MUST be Monday 2026-10-19 and the last Sunday 2026-10-25 **[unit]**

#### Scenario: Navigation links
- GIVEN any view and date
- WHEN the page renders
- THEN previous, next and "Hoy" MUST be links (no client state), and the view switcher MUST preserve `date` **[unit]**

### Requirement: Range Query and Panama Midnights

For the visible range the page MUST load appointments whose `appointment_at` lies in the half-open interval [Panama 00:00 of the first visible day, Panama 00:00 of the day after the last visible day), computed in `America/Panama` regardless of the server or database session zone. Ranges: `day` and `combined` = the selected day; `week` = Monday through Sunday of the selected day's week; `month` = every week-row the month grid draws (full Monday-start weeks, so leading and trailing days of adjacent months are inside the range). The query MUST join `cliente`, left-join `vehiculo` and MUST return, as plain strings or null, the vehicle make, model and plate, the customer name and phone, the `categoria`, the description, the status, and the technicians assigned to the order (names, one entry per technician, no duplicated order rows). It MUST need no new index and MUST be capped at 500 rows (ordered by `appointment_at` ascending, then id). Besides the orders of "Which Orders Appear" it MUST return no-show orders. When the cap truncates the range the page MUST say so with a visible notice, never silently drop rows. The query MUST be scoped by the existing `OrderScope`.

#### Scenario: Panama midnight boundary
- GIVEN orders at 23:59 Panama on day D, 00:00 Panama on D+1, and 04:59 UTC on D+1 (= 23:59 Panama on D), with the database session and server zone set to UTC
- WHEN the day view for D loads
- THEN only the orders at Panama 23:59 of D (both of them) MUST be returned and the 00:00 order of D+1 MUST NOT **[e2e]**

#### Scenario: Month range covers the drawn weeks
- GIVEN a month whose first day is a Thursday and an order on the preceding Monday
- WHEN the month view loads
- THEN that order MUST be returned and drawn in the leading cell **[e2e]**

#### Scenario: Row cap is disclosed
- GIVEN 501 appointments in the visible range
- WHEN the page loads
- THEN at most 500 MUST be returned and the notice "Se muestran las primeras 500 citas; acotá el rango." MUST render **[e2e]**

#### Scenario: Range arithmetic
- GIVEN a view and a date
- WHEN the range is computed
- THEN the pure helper MUST return the expected Panama-midnight instants for day, week, month and combined, including month and year rollovers **[unit]**

#### Scenario: Vehicle, type, description and technicians come back
- GIVEN a booked order with a vehicle (make "Toyota", model "Corolla"), `categoria` `revisado`, a description and two assigned technicians
- WHEN the range query runs against a real database
- THEN exactly one row MUST come back for that order carrying the make, model, plate, `categoria`, description and both technician names **[e2e]**

#### Scenario: Order without vehicle, type or technician
- GIVEN a booked order with null vehicle, null `categoria` and no assignment
- WHEN the range query runs
- THEN one row MUST come back with null vehicle fields, null `categoria` and an empty technician list **[e2e]**

#### Scenario: Technicians do not multiply rows
- GIVEN an order with three technicians
- WHEN the range query runs
- THEN the row count and the `count`-style totals MUST equal those of the same order with none **[e2e]**

### Requirement: Which Orders Appear

An order MUST appear on the agenda only when `appointment_at` is non-null and falls in the visible range, subject to its status: `booked` MUST appear as an actionable appointment; `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review` and `done` MUST appear muted with a status label carrying the `ORDER_STATUS_LABEL` text ("Recibida", "Completada", ...) and MUST carry no Reprogramar or "No se presentó" action; a no-show (see terms) MUST appear struck-through with the status text "No se presentó" and MUST carry no action other than "Abrir orden"; every other `cancelled` order (cancelled before its appointment time, or not cancelled from `booked`) MUST NOT appear. A muted or no-show card MUST still open its detail, whose "Abrir orden" link points to the order.

#### Scenario: Status visibility
- GIVEN one order in each of the eight statuses, all with an appointment inside the range, and the `cancelled` one cancelled from `booked` BEFORE its appointment time
- WHEN the range query runs
- THEN seven MUST be returned and the `cancelled` one MUST NOT **[e2e]**

#### Scenario: Cancelled after the appointment time is a no-show
- GIVEN a `booked` order whose appointment was at 10:00 and that was cancelled at 11:30 the same day
- WHEN the range query runs
- THEN it MUST be returned and flagged as a no-show **[e2e]**

#### Scenario: Cancelled from another status stays hidden
- GIVEN an `open` order cancelled after its appointment time, with no `booked → cancelled` history row
- WHEN the range query runs
- THEN it MUST NOT be returned **[e2e]**

#### Scenario: Booked is actionable, later statuses are muted
- GIVEN a `booked` and an `open` appointment
- WHEN the cards render
- THEN the booked card's detail MUST offer its actions and the open card MUST be visually muted, show the text "Recibida" and its detail MUST offer no action other than "Abrir orden" **[unit]**

#### Scenario: No-show card
- GIVEN a no-show appointment
- WHEN its card renders
- THEN the customer name MUST be struck through, the text "No se presentó" MUST be visible and its detail MUST NOT offer Reprogramar or "No se presentó" **[unit]**

#### Scenario: Order without an appointment is absent
- GIVEN a `booked` or `open` order with null `appointment_at`
- WHEN any view loads
- THEN it MUST NOT appear in the grid **[e2e]**

### Requirement: Chip Content

Every appointment card (the `chip` of the earlier spec) MUST show, in this order: a header strip with the time as `HH:mm` (24-hour, Panama time, digits and a colon only) and the type label (`HH:mm · REVISADO`, or `HH:mm · Sin categoría` when the type is null); the customer name; the vehicle as `plate · make model`, or the text "Sin vehículo" when the order has no vehicle; the initials of the assigned technicians (or the text "Sin técnico" when there are none, on a booked card); and a status label for every status except a non-Vencida `booked`: "Recibida", "Completada" (and the other `ORDER_STATUS_LABEL` texts), "Vencida", "No se presentó". The card colour MUST be one hue per type (a neutral grey for "Sin categoría"), light and dark, and the status MUST ALSO be present as text, never colour alone. Muted statuses render attenuated, Vencida carries a red ring, a no-show is struck through. Cards MUST NOT show the customer phone or the description (both live in the detail). Technician initials are the first letters of the first two words of the name, upper-case, with the full name in the accessible name. A card MUST be a button that opens its detail (it is no longer a link). Card text MUST truncate or wrap without overflowing its block. Appointments at the same or overlapping times MUST all render, none hidden or overwritten, in a stable order (start time, then id). There is no duration, capacity or technician-column concept.

#### Scenario: Card fields
- GIVEN a booked order for "Jorge Vega", plate "AC 5521", Toyota Corolla, `revisado`, technician "Julio Rangel", at 11:00 Panama
- WHEN its card renders
- THEN it MUST show "11:00 · REVISADO", "Jorge Vega", "AC 5521 · Toyota Corolla" and "JR", MUST show no status label, and MUST NOT show the phone or the description **[unit]**

#### Scenario: No vehicle, no type, no technician
- GIVEN a booked order with null vehicle, type and technicians
- WHEN its card renders
- THEN it MUST show "Sin categoría" in the strip, "Sin vehículo" and "Sin técnico", use the neutral colour, and MUST NOT throw **[unit]**

#### Scenario: Status is text as well as colour
- GIVEN a received order, a done order, a Vencida booked order and a no-show
- WHEN their cards render
- THEN they MUST show the texts "Recibida", "Completada", "Vencida" and "No se presentó" respectively **[unit]**

#### Scenario: Colour follows the type
- GIVEN one booked card per type
- WHEN they render
- THEN the five typed cards MUST carry five distinct type hooks and the null-type card MUST carry the neutral one **[unit]**

#### Scenario: Overlap is deterministic
- GIVEN three appointments at 09:00 on the same day
- WHEN the day renders
- THEN all three cards MUST be present, in a stable order (start time, then id) **[unit]**

#### Scenario: Time text is identical on server and client
- GIVEN an appointment at 2026-10-26T19:05:00Z
- WHEN the time text is formatted anywhere in the module
- THEN it MUST read "14:05" using a digit-only formatter and MUST NOT use `toLocaleString`/`Intl` locale text in any `"use client"` file **[unit]**

#### Scenario: Technician initials
- GIVEN technicians "Julio Rangel" and "Marta"
- WHEN initials are derived
- THEN they MUST read "JR" and "M" **[unit]**

### Requirement: Day, Week and Month Layout

Views MUST be a hand-rolled layout (no calendar library, no new dependency); the card, grid and navigation markup MAY be server-rendered and the selection, filter, tab and search state lives in one client shell that receives only serializable props.

`day` and `week` (and the day list of `combined`) draw an hour grid from 08:00 to 18:00 Panama time, one row per hour with the hour label. The grid MUST extend, by whole hours, to include any appointment in range that starts before 08:00 or ends after 18:00, so none is hidden. Every appointment occupies a fixed 1-hour block starting at its start time (a 14:30 card spans 14:30–15:30); in the `day` view (and the day list of `combined`) blocks whose times overlap MUST share the column width side by side in equal lanes, none stacked out of view. A `week` column is too narrow for lanes, so there an overlapping run of blocks MUST show its first card (start time, then id) at the full column width beside a 44x44 "+N más" link (N = the hidden cards of that run) to the `day` view of that date; a run without overlap is unchanged. `week` has seven Monday-first day columns headed by weekday and day number with the per-day appointment count; weekend columns MUST be visibly marked; the column of today's Panama day MUST be marked with a "Hoy" label and a highlighted header. On today's column only, a now-line MUST be drawn at the current Panama time (server clock at render, `HH:mm` label, no polling) and MUST NOT be drawn when the time is outside the grid's hours or on any other day. A day with no appointments MUST still show the empty grid and the text "Sin citas para este día" in the `day` view. Clicking or activating a free part of an hour row opens "Nueva cita" (see Booking Dialog); each free slot MUST be a focusable control with an accessible name stating the day and hour.

`month`: a Monday-first grid of week rows; from `md` width up each cell shows the day number and at most 3 compact cards ordered by time (`HH:mm` plus plate, or the customer's first name when there is no vehicle, coloured by type, with a status glyph and accessible status text); when a day has more, the cell MUST show a control "+N más" (N = the hidden count) that opens the `day` view for that date. A month card opens its detail. On a phone width the cells are too narrow for cards, so each cell MUST show only the day number (a link to the `day` view) and, when the day has appointments, the per-day count with accessible text such as "2 citas"; cards and "+N más" are not rendered there. Days outside the month MUST be drawn dimmed but still carry their cards. Today's Panama day MUST be marked. Every day cell, card, slot control and "+N más" control MUST be at least 44x44 where the viewport is coarse-pointer.

On a phone width `day`, `week` and `combined` MUST show a horizontally scrollable day strip of the selected day's Monday–Sunday week (each day a link of at least 44x44 that rewrites `date`, today marked, a dot on days with appointments, the selected day highlighted) above the hour grid of the selected day only; the strip scrolls inside itself and the page MUST NOT scroll horizontally. The mini calendar and its column are not shown on a phone.

#### Scenario: Grid hours and block position
- GIVEN a day with appointments at 08:00, 14:30 and 17:00
- WHEN the day view renders
- THEN the grid MUST have rows 08:00 through 17:00 (ending at 18:00), each card MUST occupy a one-hour block, and the 14:30 block MUST start half a row below the 14:00 line **[unit]**

#### Scenario: Outside the window nothing is hidden
- GIVEN appointments at 07:15 and 18:45
- WHEN the day view renders
- THEN both cards MUST render and the grid MUST extend to include 07:00 and 19:00–20:00 **[unit]**

#### Scenario: Overlap shares the width
- GIVEN appointments at 11:00 and 11:00, and one at 11:30
- WHEN the day grid renders
- THEN the three blocks MUST sit side by side in three equal lanes, none covering another **[unit]**

#### Scenario: Overlap in the week is one lane
- GIVEN three appointments at 09:00 on one day of the week view
- WHEN the week renders
- THEN the column MUST show the first card (start time, then id) at full width and a "+2 más" link of at least 44x44 to `/agenda?view=day&date=<that day>`, and an appointment run without overlap MUST render unchanged and without the link **[unit]**

#### Scenario: Now-line only on today
- GIVEN the week containing today, at 10:40 Panama
- WHEN the week view renders
- THEN exactly one now-line labelled "10:40" MUST render, in today's column **[unit]**
- AND a view not containing today MUST render none **[unit]**

#### Scenario: Now-line outside the grid
- GIVEN the time 19:30 Panama and the default grid
- WHEN today's day view renders
- THEN no now-line MUST render **[unit]**

#### Scenario: Today and weekends are marked
- GIVEN the week view
- WHEN it renders
- THEN today's header MUST carry the text "Hoy" and the Saturday and Sunday columns MUST carry the weekend mark **[unit]**

#### Scenario: Empty slot is a labelled control
- GIVEN an empty week column
- WHEN the grid renders
- THEN each free hour MUST expose a focusable control whose accessible name includes the day and the hour **[unit]**

#### Scenario: Month cell cap
- GIVEN a day with 5 appointments
- WHEN the month view renders at `md` width or wider
- THEN the cell MUST show the first 3 cards by time and a "+2 más" control that opens `/agenda?view=day&date=<that day>` **[unit]**

#### Scenario: Exactly three cards show no overflow control
- GIVEN a day with exactly 3 appointments
- WHEN the month view renders
- THEN no "+N más" control MUST render **[unit]**

#### Scenario: Singular and plural are not special-cased
- GIVEN a day with 4 appointments
- WHEN the month view renders
- THEN the control MUST read "+1 más" **[unit]**

#### Scenario: Phone month cell shows a count only
- GIVEN a day with 5 appointments
- WHEN the month view renders on a phone width
- THEN the cell MUST show the day number and the count, and the cards and the "+N más" control MUST be hidden at that width **[unit]**

#### Scenario: Month card carries status text
- GIVEN a Vencida booked appointment in a month cell
- WHEN the compact card renders
- THEN it MUST carry a status glyph and the accessible text "Vencida" in addition to its colour **[unit]**

#### Scenario: Empty day
- GIVEN a day with no appointments
- WHEN the day view renders
- THEN it MUST show the explicit empty state "Sin citas para este día" **[unit]**

#### Scenario: Phone day strip
- GIVEN the week view at 390 px with appointments on Tuesday and Thursday
- WHEN it renders
- THEN a seven-day strip MUST render with a dot on those two days, each day a link rewriting `date`, and the hour grid of the selected day only **[unit]**

#### Scenario: Tablet and phone layouts
- GIVEN each view opened on a laptop width (about 1024 px), a tablet width (about 768 px) and a 390 px phone at the LAN IP, in light and dark
- WHEN rendered with realistic data
- THEN no view MUST scroll the page horizontally, the layouts MUST match the corresponding mockup frame, and cards MUST stay legible **[browser]**

#### Scenario: Hit targets
- GIVEN cards, slot controls, month day cells, "+N más" controls, tabs, phone chips, day-strip days and the action buttons
- WHEN rendered on a touch device
- THEN each MUST measure at least 44x44 **[browser]**

### Requirement: Combined View

The `combined` view MUST show, for the selected day, that day's hour grid with its appointments (same cards, now-line, slot controls and rules as the day view) together with a panel "En el taller ahora" listing all orders currently in the workshop, with a count badge. The in-workshop set MUST be every order whose current status is `open`, `diagnosing`, `in_progress`, `on_hold` or `ready_for_review`, regardless of any appointment date or the selected day. Each in-workshop card MUST show the type colour dot, the plate and vehicle make and model (or "Sin vehículo"), the customer name, the status label ("Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión"), the time in the current status ("N min", "H h M min", or "N día"/"N días"; computed on the server at render from the latest status-change history row, falling back to the order's creation time), the technician initials (or "Sin técnico"), and, only while `on_hold`, the hold reason label with how long ago it began (`Repuesto · hace 2 días`) in a warning treatment; the card MUST link to `/service-orders/<id>`. The customer phone is not shown there. `done`, `cancelled` and `booked` MUST NOT be in the list. On wide screens the grid and the panel MUST sit side by side; on a phone they MUST be stacked (grid first, then panel). The in-workshop query MUST live in `src/modules/agenda/`, not in `src/modules/board/queries.ts`, and MUST be capped like the range query.

The agenda is a staff-only surface and MAY carry customer name and phone. This does NOT relax the workshop status board: the board's field whitelist, the `board.*` payloads and the rule that board queries never join `cliente` MUST remain unchanged.

#### Scenario: In-workshop set
- GIVEN one order in each of the eight statuses
- WHEN the combined view loads
- THEN the in-workshop list MUST contain exactly the five in-workshop statuses, independent of the selected date **[e2e]**

#### Scenario: Hold reason shown only while on hold
- GIVEN an `on_hold` order with reason `repuesto` held for two days and an `in_progress` order
- WHEN the in-workshop cards are built
- THEN the first MUST carry the Spanish hold-reason label and "hace 2 días" and the second MUST carry none **[unit]**

#### Scenario: Time in status
- GIVEN orders whose latest status change was 35 minutes, 2 h 40 min, 1 day and 2 days before now
- WHEN the cards are built
- THEN they MUST read "35 min", "2 h 40 min", "1 día" and "2 días" **[unit]**

#### Scenario: Time in status uses the history row
- GIVEN an order created 5 days ago and moved to `in_progress` 3 hours ago
- WHEN the in-workshop query runs
- THEN its since-time MUST be derived from the 3-hour-old history row **[e2e]**

#### Scenario: Technicians on the card
- GIVEN an in-workshop order with technicians "Marta Pinzón" and "Julio Rangel", and one with none
- WHEN the cards render
- THEN they MUST show "MP JR" and "Sin técnico" respectively **[unit]**

#### Scenario: Selected day and live orders together
- GIVEN a booked appointment on the selected day and an `in_progress` order created for another day
- WHEN the combined view renders
- THEN both MUST be visible on the page **[e2e]**

#### Scenario: Side by side and stacked
- GIVEN the combined view
- WHEN opened on a wide screen and on a 390 px phone at the LAN IP
- THEN the lists MUST be side by side on the wide screen and stacked (grid first) on the phone without horizontal page scroll **[browser]**

#### Scenario: Board payload still carries no customer data
- GIVEN a database whose orders belong to a customer named with a sentinel name and phone
- WHEN `GET /api/board` and `GET /api/board/clientes` are called after this change
- THEN neither body MUST contain the sentinel name or phone, and `src/modules/board/queries.ts` MUST still not reference `cliente` **[e2e]**

### Requirement: Vencida Rule

A `booked` order MUST be Vencida when `appointment_at < now − 60 minutes`; the margin MUST be a single exported constant (`OVERDUE_MARGIN_MINUTES = 60`) used by every caller, and the comparison MUST be strict (an appointment exactly 60 minutes old is not yet Vencida). A non-`booked` order is never Vencida. The flag MUST be computed on the server from a server clock and passed to client components as a plain boolean; the client MUST NOT compute it. A Vencida card MUST carry the visible label "Vencida" in addition to any colour, so it does not rely on colour alone.

#### Scenario: Margin boundary
- GIVEN a booked appointment 59 min, exactly 60 min and 61 min before now
- WHEN `isOverdue` is evaluated
- THEN only the 61-minute one MUST be Vencida **[unit]**

#### Scenario: Margin boundary in SQL
- GIVEN the same three rows in a real database
- WHEN the overdue query runs
- THEN only the 61-minute row MUST be returned **[e2e]**

#### Scenario: Only booked orders are Vencida
- GIVEN an `open` order whose appointment was three hours ago
- WHEN the page renders
- THEN it MUST be muted with its status badge and MUST NOT be labelled "Vencida" **[unit]**

#### Scenario: Flag is a server-computed boolean
- GIVEN the agenda page's props for a client component
- WHEN they are serialized
- THEN the overdue flag MUST be a boolean and no `Date`/clock MUST be needed on the client to decide it **[unit]**

### Requirement: Reprogramar

"Reprogramar" and "No se presentó" are offered in the appointment's Detail (and nowhere on cards): a card, a month card or a Vencidas-tab row opens the Detail on every view, so every booked and every Vencida order stays actionable from any view and tab. A `booked` appointment (including a Vencida one) MUST offer "Reprogramar" in its Detail, opening a dialog with a day field and an `HH:mm` time field prefilled from the current appointment (in Panama time, from server-provided digit-only text). On submit the client MUST send `PATCH /api/service-orders/[id]` with `{ appointmentAt, expectedStatus: "booked" }`, `appointmentAt` being an ISO-8601 string built from the chosen day and time with the explicit offset `-05:00`; it MUST NOT use the browser's local time zone, `datetime-local`, or `Date` parsing of the local zone. The system MUST rely on the existing reminder behaviour: the pending `appointment` reminder is cancelled and a new one planned for the new time. On success the dialog and the Detail MUST close, the toast "Cita reprogramada" MUST be added above `router.refresh()` and both MUST sit below the `try/catch`. The route MUST accept the optional `expectedStatus` on a field PATCH exactly as on a status PATCH: validated like the status path (a value outside `OrderStatus` is a 400 with `{ errors: { expectedStatus: "Estado esperado inválido" } }`), compared with the status read under the row lock BEFORE any write, and a mismatch MUST answer the same 409 `{ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }` with nothing written and no reminder changed; a field PATCH without `expectedStatus` MUST behave exactly as before. A refusal (403/409/400) MUST show the route's Spanish message inline in the dialog and MUST NOT toast success or close the dialog. The submit button MUST be disabled while the request is in flight. A day or time left empty MUST be rejected client-side with a Spanish message, without a request.

#### Scenario: Request body
- GIVEN the dialog with day 2026-10-30 and time 15:30
- WHEN staff submits
- THEN the PATCH body MUST be `{ "appointmentAt": "2026-10-30T15:30:00-05:00", "expectedStatus": "booked" }` from a browser in any time zone **[unit]**

#### Scenario: Reschedule persists and replans the reminder
- GIVEN a booked order with a pending `appointment` reminder
- WHEN the PATCH is applied
- THEN `appointment_at` MUST equal the new instant, the old pending reminder MUST be cancelled and a new one planned (when the new time is at least 24 h ahead) **[e2e]**

#### Scenario: Success feedback
- GIVEN a successful PATCH
- WHEN the dialog finishes
- THEN the toast "Cita reprogramada" MUST show once, the dialog and the Detail MUST close and the grid MUST refresh **[unit]**

#### Scenario: Order no longer booked
- GIVEN the order was received in another session after the page loaded
- WHEN staff submits the dialog
- THEN the route MUST answer 409 `stale_status` **[unit]**, `appointment_at` MUST be unchanged and no reminder MUST change **[e2e]**, and the dialog MUST show the route's message inline, show no success toast and stay open **[unit]**

#### Scenario: Reprogram without expectedStatus is unchanged
- GIVEN a field PATCH `{ appointmentAt }` with no `expectedStatus` on an order the caller may edit
- WHEN the route handles it
- THEN it MUST apply as before **[unit][e2e]**

#### Scenario: Reprogramar lives in the Detail only
- GIVEN booked and Vencida appointments in every view
- WHEN the cards render
- THEN no Reprogramar or "No se presentó" control MUST render on any card, and opening a card's Detail MUST offer Reprogramar for a booked order **[unit]**

#### Scenario: Reprogramar from the Vencidas tab
- GIVEN a Vencida order outside the visible range
- WHEN staff opens its row in the Vencidas tab
- THEN the Detail MUST offer Reprogramar and "No se presentó" **[unit]**

#### Scenario: Reprogramar not offered to a muted order
- GIVEN an `open` appointment
- WHEN its Detail renders
- THEN no Reprogramar control MUST render **[unit]**

### Requirement: No se presentó

A `booked` appointment that is Vencida MUST offer "No se presentó" in its Detail. Clicking it MUST open a confirmation (copy states that the order will be cancelled) before any request; confirming MUST send `PATCH /api/service-orders/[id]` with `{ status: "cancelled", expectedStatus: "booked" }`. The route MUST accept an optional `expectedStatus` on a status transition and, under the existing row lock, refuse with 409 and the Spanish message "La orden cambió mientras la mirabas. Actualizá la agenda." when the locked status differs, writing nothing. Cancelling is terminal, so without this a stale screen could cancel an order that was received in the meantime. A transition without `expectedStatus` MUST behave exactly as today. It is an ordinary cancellation: no reason is asked, no counter or no-show flag is stored, and the existing cancellation side effects apply unchanged (pending reminders cancelled, a `booked → cancelled` history row written); the order then reads as a no-show because of that history row. On success the toast MUST be "Orden cancelada" (the existing copy of `OrderStatusControls`'s `successMessage` for a `cancelled` target), placed above `router.refresh()` and below the `try/catch`, and the Detail MUST close. If the order changed concurrently (409, or a refusal because its status no longer permits cancellation), the route's Spanish message MUST be surfaced inline in the confirmation, no success toast MUST show and the dialog MUST stay open until dismissed. The submit button MUST be disabled while in flight.

#### Scenario: Stale no-show is refused
- GIVEN a Vencida booked order on a screen, and another operator receives it (`booked → open`) before the click
- WHEN "No se presentó" is confirmed
- THEN the PATCH MUST answer 409 "La orden cambió mientras la mirabas. Actualizá la agenda.", the order MUST stay `open`, no history row MUST be written and no toast MUST show **[e2e]**

#### Scenario: Transitions without expectedStatus are unchanged
- GIVEN any existing status PATCH without `expectedStatus`
- WHEN it is sent
- THEN it MUST behave exactly as before this change **[unit]**

#### Scenario: Confirmation precedes the request
- GIVEN the Detail of a Vencida appointment
- WHEN staff clicks "No se presentó"
- THEN no request MUST be sent until the confirmation is accepted; dismissing sends nothing **[unit]**

#### Scenario: Cancels as an ordinary cancellation
- GIVEN a Vencida booked order with a pending reminder
- WHEN the confirmed PATCH is applied
- THEN the status MUST be `cancelled`, the pending reminder MUST be cancelled, exactly one `booked → cancelled` history row MUST exist and no other column MUST record a no-show **[e2e]**

#### Scenario: Success feedback
- GIVEN a successful cancellation
- WHEN the dialog finishes
- THEN the toast "Orden cancelada" MUST show, the order MUST leave the Vencidas tab and its count, and its card MUST re-render as a struck-through "No se presentó" **[unit]**

#### Scenario: Concurrent change surfaces inline
- GIVEN the order was received (or cancelled) by someone else after the page loaded
- WHEN staff confirms
- THEN the route's Spanish message MUST appear inline, no success toast MUST show **[unit]**

#### Scenario: Not offered where it does not apply
- GIVEN a booked appointment that is not yet Vencida, a non-booked appointment and a no-show
- WHEN their Details render
- THEN none MUST offer "No se presentó" **[unit]**

### Requirement: Booking Dialog

The agenda MUST offer a "Nueva cita" button in the page header (and, on a phone, a floating "Nueva cita" button of at least 44 px height) opening a centred dialog with: a day field, an `HH:mm` time field, a customer picker (reusing `CustomerPicker`, its existing props staying backward compatible for `ServiceOrderForm`), an optional "Vehículo" choice, an optional "Categoría" choice and a description; its submit button reads "Agendar cita". "Vehículo (opcional)" MUST list only the selected customer's vehicles as `plate · make model` choices, MUST be unselected by default and clearable, MUST show a note when the customer has none, and MUST reset when the customer changes. "Categoría (opcional)" MUST offer the five types, none preselected, a chosen one clearable. Technician MUST NOT be asked. On submit the client MUST send `POST /api/service-orders` with `status: "booked"`, the chosen `clienteId`, `description` and `appointmentAt` built from day and time with the explicit offset `-05:00`, plus `vehiculoId` and `categoria` only when chosen, and never `tecnicoIds`. The dialog opens in three ways: from the header or floating button the day field defaults to the selected `date` and time is empty; from an empty slot of the hour grid (day, week, combined, desktop or phone) the day and the time (the slot's hour, `:00`) are prefilled; from the "+" control of a month day cell the day is prefilled. Customer, day and time are required and an empty one MUST be rejected client-side with a Spanish message. On success the dialog MUST close, the toast "Cita agendada" MUST be added above `router.refresh()` and below the `try/catch`, and the new card MUST appear in its slot without a manual reload. A server rejection (including a vehicle that does not belong to the customer) MUST show its Spanish message inline and keep the dialog open. The dialog MUST NOT use `crypto.randomUUID` or any secure-context-only API, and MUST NOT format dates with locale text on the client. An order created without vehicle or type MUST appear as "Sin vehículo" / "Sin categoría".

#### Scenario: Request body without the optional fields
- GIVEN customer C, day 2026-11-02, time 09:00 and a description, no vehicle and no type chosen
- WHEN staff submits
- THEN the POST body MUST carry `status: "booked"`, `clienteId: C`, the description and `appointmentAt: "2026-11-02T09:00:00-05:00"`, and no `vehiculoId`, `categoria` or `tecnicoIds` **[unit]**

#### Scenario: Request body with vehicle and type
- GIVEN the same input with vehicle V of the customer and type `instalacion` chosen
- WHEN staff submits
- THEN the POST body MUST also carry `vehiculoId: V` and `categoria: "instalacion"` and still no `tecnicoIds` **[unit]**

#### Scenario: Persists as booked
- GIVEN the POST without vehicle or type
- WHEN it is applied
- THEN a `booked` order with null vehicle and category, the chosen appointment instant and one `null → booked` history row MUST exist, and a reminder MUST be planned when the time is at least 24 h ahead **[e2e]**

#### Scenario: Persists vehicle and type
- GIVEN the POST with vehicle and type
- WHEN it is applied
- THEN the order MUST be `booked` with that `vehiculo_id` and `categoria` **[e2e]**

#### Scenario: Vehicle choices follow the customer
- GIVEN customer A with two vehicles and customer B with none
- WHEN staff selects A, picks a vehicle, then switches to B
- THEN A's vehicles MUST be listed as `plate · make model`, and after switching the choice MUST be cleared and the no-vehicles note shown **[unit]**

#### Scenario: Optional choices are clearable
- GIVEN a chosen vehicle and a chosen type
- WHEN staff activates each again
- THEN each MUST become unselected and the body MUST omit it **[unit]**

#### Scenario: Slot prefill
- GIVEN an empty Thursday 2026-10-29 11:00 slot
- WHEN staff activates it
- THEN the dialog MUST open with day 2026-10-29 and time 11:00 **[unit]**

#### Scenario: Header and floating button defaults
- GIVEN the selected date 2026-11-05
- WHEN the dialog opens from the header or the phone floating button
- THEN the day field MUST read 2026-11-05 and the time MUST be empty **[unit]**

#### Scenario: Month cell prefill
- GIVEN the dialog opened from the "+" of the month cell of 2026-11-05
- WHEN it renders
- THEN the day field MUST read 2026-11-05 **[unit]**

#### Scenario: Required fields
- GIVEN no customer, or no day, or no time
- WHEN staff submits
- THEN a Spanish validation message MUST show and no request MUST be sent **[unit]**

#### Scenario: Success feedback
- GIVEN a successful POST
- WHEN the dialog finishes
- THEN the toast "Cita agendada" MUST show once and the new card MUST be visible in its slot **[browser]**

#### Scenario: Server rejection stays inline
- GIVEN a POST the server rejects
- WHEN the response arrives
- THEN the message MUST appear in the dialog, no toast MUST show and the dialog MUST stay open **[unit]**

#### Scenario: Works over plain HTTP on the LAN
- GIVEN the dialog opened at `http://<lan-ip>:3000` from a second machine
- WHEN staff books an appointment
- THEN it MUST complete with no console error and no use of a secure-context-only API **[browser]**

### Requirement: Quick Customer Create

The customer picker inside the booking dialog MUST offer a slim "create customer" form with only name and phone (no opt-out fields, no other customer fields), submitting `POST /api/customers`. The server's validation (name required; phone 7–15 digits) MUST be surfaced inline per field. On 201 the new customer MUST become the picker's selected customer, the toast "Cliente creado" MUST show (above `router.refresh()` where a refresh exists, below the `try/catch`), and the booking dialog MUST stay open with its other fields untouched. The quick form MUST be nested in the booking dialog without ever submitting the outer form: its submit handler MUST call `event.preventDefault()` and `event.stopPropagation()`, and the form MUST NOT be a DOM descendant `<form>` of the outer one (or must portal out) so that Enter in a quick-form field never submits the booking.

On `409 { error: "duplicate_phone", existingClienteId }` the form MUST offer three choices: "Ver el cliente existente" (shows the existing customer's name and details, fetched with `GET /api/customers?search=<phone>&pageSize=50&status=all`, so a deactivated match is visible, without leaving the dialog), "Usar ese cliente" (selects the existing customer in the picker and closes the quick form, creating nothing) and "Guardar igual" (resubmits with `allowDuplicatePhone: true`, creating a second customer with the same phone). While a duplicate is shown, the primary create button MUST NOT be a way to create silently. If the lookup shows the existing customer is deactivated, "Usar ese cliente" MUST NOT be clickable (an order needs an active customer; `POST /api/service-orders` answers 409 `cliente_deactivated`) and a Spanish note MUST say so; "Guardar igual" stays available, because creating a new customer that shares a phone with a deactivated one is allowed (`POST /api/customers` has no `cliente_deactivated` refusal — that 409 exists only on edit, `api/customers/[id]/route.ts:139`). Both buttons MUST be disabled while a request is in flight.

#### Scenario: Only two fields
- GIVEN the quick form
- WHEN it renders
- THEN it MUST contain a name input and a phone input and MUST NOT contain `whatsappOptOut`, `emailOptOut` or any other customer field **[unit]**

#### Scenario: Successful create selects the customer
- GIVEN valid name and phone
- WHEN staff submits the quick form
- THEN the customer MUST be created, selected in the picker, the toast "Cliente creado" MUST show and the booking dialog MUST remain open **[unit]**

#### Scenario: Nested submit does not submit the booking
- GIVEN the quick form open inside the booking dialog with the booking fields filled
- WHEN staff presses Enter or the quick form's submit button
- THEN `POST /api/customers` MUST be called and `POST /api/service-orders` MUST NOT **[unit]**

#### Scenario: Nested submit in a real browser
- GIVEN the same flow in Chromium over the LAN IP
- WHEN staff creates a customer inside the booking dialog
- THEN the booking dialog MUST not close or submit and the console MUST show no React nesting/hydration warning **[browser]**

#### Scenario: Duplicate phone offers three choices
- GIVEN a `409 duplicate_phone` answer
- WHEN the quick form handles it
- THEN it MUST render "Ver el cliente existente", "Usar ese cliente" and "Guardar igual" **[unit]**

#### Scenario: Usar ese cliente
- GIVEN the duplicate state
- WHEN staff chooses "Usar ese cliente"
- THEN the existing customer MUST be selected in the picker and no new customer MUST be created **[unit]**

#### Scenario: Guardar igual
- GIVEN the duplicate state
- WHEN staff chooses "Guardar igual"
- THEN the form MUST resubmit with `allowDuplicatePhone: true`, a second customer with that phone MUST exist, the flag MUST NOT be stored, and that customer MUST be selected **[e2e]**

#### Scenario: Duplicate detection is real
- GIVEN an existing customer with phone P
- WHEN `POST /api/customers` is sent with phone P and no flag
- THEN the answer MUST be 409 `duplicate_phone` with `existingClienteId` and nothing MUST be inserted **[e2e]**

#### Scenario: Deactivated duplicate cannot be reused
- GIVEN the existing customer with that phone is deactivated
- WHEN the duplicate state renders
- THEN "Usar ese cliente" MUST NOT be clickable and "Guardar igual" MUST stay available **[unit]**

#### Scenario: Create requires customers.write
- GIVEN an `administrador` or `jefe_taller`
- WHEN the quick form submits
- THEN `customers.write` MUST be satisfied by both roles; the form MUST NOT render for a user lacking `customers.write` **[unit]**

### Requirement: Rendering Safety on the LAN

The agenda MUST be usable at `http://<lan-ip>:3000` from a second machine. No agenda file MUST use `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, `mediaDevices`, geolocation, service workers or any other secure-context-only API. Date and time text MUST be produced by digit-only formatters (pure `formatToParts`/arithmetic helpers) so Node and the browser render identical strings; no `"use client"` file MUST call `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` or `Intl.DateTimeFormat` without a digit-only `formatToParts` projection. Props crossing the Server Component boundary MUST be serializable (no functions, no `Date` instances). Portals/dialogs MUST NOT be gated by `typeof document`. The page MUST have no polling (manual refresh through the existing `RefreshListButton`).

#### Scenario: No secure-context APIs
- GIVEN every file under `src/modules/agenda/` and `src/app/(app)/agenda/`
- WHEN a text test scans them
- THEN none MUST reference a secure-context-only API listed above **[unit]**

#### Scenario: No client locale date text
- GIVEN every `"use client"` file in the agenda module
- WHEN a text test scans them
- THEN none MUST call a locale date formatter other than the digit-only helper **[unit]**

#### Scenario: No hydration or RSC errors
- GIVEN each of the four views, the booking dialog, Reprogramar and "No se presentó" opened at the LAN IP with real data (including a month with more than 3 appointments in a cell)
- WHEN the browser console is read
- THEN there MUST be no hydration or Server Component serialization error **[browser]**

#### Scenario: Manual refresh
- GIVEN the agenda
- WHEN staff presses the refresh control
- THEN the grid MUST reload from the server and no interval or polling timer MUST exist **[unit]**

### Requirement: Appointment Detail

Activating any card (grid, month or Vencidas-tab row) MUST open that appointment's Detail and mark the card as selected. From `md` width up the Detail is a popover panel (about 340 px wide) placed so it is not clipped by, and does not overflow, the narrow day column (a fixed side placement is acceptable); below `md` it is a bottom sheet with a close control. Both close with Escape, an outside activation and the close control, which is at least 44x44. Neither is gated by `typeof document`. The Detail MUST show: a status label (for a booked non-Vencida order "Cita agendada"; otherwise the status text); the customer name; the day and time as text from static Spanish weekday and month tables (for example "Martes 27 de octubre" and "11:00"); the vehicle as `plate · make model year` or "Sin vehículo"; the customer phone as a `tel:` link; the description (wrapping, and the sheet or panel scrolling when long; "Sin descripción" when empty); the five type chips with the order's type marked (none marked for "Sin categoría"); the assigned technicians with initials and full names; an "Abrir orden" link to `/service-orders/<id>` (primary button, and the pencil icon button with accessible name "Abrir orden"); and, by status, the actions of Reprogramar and No se presentó. For a `booked` appointment the type chips and "+ Asignar técnico" MUST be editable through the existing routes: choosing a chip sends `PATCH /api/service-orders/[id]` with `{ categoria, expectedStatus: "booked" }`; assigning sends `POST /api/service-orders/[id]/assignments` with the chosen `tecnicoId`. For any other status the chips and technicians are read-only and there is no assign control. Each edit MUST add a success toast ("Categoría actualizada", "Técnico asignado") above `router.refresh()` and below the `try/catch`, show a refusal (403/409/400) inline in the Detail without a success toast, and disable its control while in flight. The picker of assignable technicians lists active technicians only.

#### Scenario: Detail content
- GIVEN the booked appointment of "Jorge Vega" (AC 5521, Toyota Corolla 2019, 6612-4480, type `revisado`, technician "Julio Rangel") on Tuesday 2026-10-27 at 11:00
- WHEN its card is activated
- THEN the Detail MUST show "Cita agendada", "Jorge Vega", "Martes 27 de octubre", "11:00", "AC 5521 · Toyota Corolla 2019", a `tel:` link on the phone, the description, the five chips with "REVISADO" marked, "Julio Rangel", "Abrir orden", "Reprogramar" and no "No se presentó" (not yet Vencida) **[unit]**

#### Scenario: Vencida Detail offers both actions
- GIVEN a Vencida booked appointment
- WHEN its Detail renders
- THEN it MUST offer "Abrir orden", "Reprogramar" and "No se presentó" **[unit]**

#### Scenario: Muted Detail is read-only
- GIVEN an `open` appointment
- WHEN its Detail renders
- THEN it MUST show the chips and technicians without edit controls and MUST offer only "Abrir orden" **[unit]**

#### Scenario: Presentation by width
- GIVEN a card activated at 1024 px and at 390 px
- WHEN the Detail opens
- THEN it MUST be a popover panel at 1024 px and a bottom sheet with a close control at 390 px **[browser]**

#### Scenario: Close affordances
- GIVEN an open Detail
- WHEN staff presses Escape, activates outside it, or activates the close control
- THEN it MUST close each time and the card MUST lose its selected mark **[unit]**

#### Scenario: Not clipped in a week column
- GIVEN a card in the Monday column of the week view at 1024 px
- WHEN its Detail opens
- THEN the Detail MUST be fully visible and MUST NOT widen the page **[browser]**

#### Scenario: Edit the type
- GIVEN a booked appointment of type `revisado`
- WHEN staff chooses the chip "Reparación"
- THEN the request MUST be `PATCH` with `{ "categoria": "reparacion", "expectedStatus": "booked" }`, and on success the toast "Categoría actualizada" MUST show above the refresh **[unit]**

#### Scenario: Edit the type persists
- GIVEN that PATCH applied to a booked order
- WHEN the order is read back
- THEN its `categoria` MUST be `reparacion` **[e2e]**

#### Scenario: Stale type edit
- GIVEN the order was received elsewhere after the page loaded
- WHEN staff chooses a chip
- THEN the route's 409 message MUST appear inline in the Detail, no toast MUST show and `categoria` MUST be unchanged **[unit][e2e]**

#### Scenario: Assign a technician
- GIVEN a booked appointment with no technician and a permitted user
- WHEN staff activates "+ Asignar técnico" and picks an active technician
- THEN `POST /api/service-orders/<id>/assignments` MUST be sent with that `tecnicoId`, the toast "Técnico asignado" MUST show and the card's initials MUST appear after the refresh **[unit]**

#### Scenario: Assign refusal stays inline
- GIVEN the assignments route answers 409 `order_closed`
- WHEN staff assigns
- THEN its message MUST show inline in the Detail and no success toast **[unit]**

### Requirement: Agenda Tabs

Replacing the earlier Vencidas panel, the page MUST render the tabs "Todas", "Agendadas" and "Vencidas" above the calendar, on every view, as client state (they do not change the URL) with "Todas" selected on load. "Todas" shows every card of the loaded range. "Agendadas" shows only the `booked` cards that are not Vencida, with a count badge of those in the loaded range. "Vencidas" replaces the calendar area with a list of every Vencida order irrespective of the visible range or selected date, ordered by `appointment_at` ascending (oldest first), each row showing the card fields and its full Panama date as digits (`DD/MM/YYYY HH:mm`) and opening the Detail; its badge MUST show the true number N of Vencida orders (red). The list MUST be capped at 500 rows with a visible notice when truncated, and with N = 0 MUST show "Sin citas vencidas" (the badge is then 0 or absent, never wrong). On a phone the tabs render as pill chips of at least 44 px height. Switching a tab MUST NOT reload the page or lose search text and filters.

#### Scenario: Tabs on every view
- GIVEN one Vencida order
- WHEN each of the four views renders
- THEN each MUST show the tabs "Todas", "Agendadas" and "Vencidas" with the Vencidas badge reading 1 **[unit]**

#### Scenario: Old overdue appointment never disappears
- GIVEN a booked appointment 40 days ago and the week view of the current week
- WHEN the staff opens the Vencidas tab
- THEN the order MUST be listed and the badge MUST read 1 **[e2e]**

#### Scenario: Count is the true count
- GIVEN 3 Vencida orders, one of them inside the visible range
- WHEN the page renders
- THEN the Vencidas badge MUST read 3 and the tab MUST list all three **[e2e]**

#### Scenario: Agendadas excludes Vencida and muted
- GIVEN a booked future, a Vencida booked, an `open` and a no-show appointment in range
- WHEN the "Agendadas" tab is selected
- THEN only the booked future card MUST show **[unit]**

#### Scenario: Todas shows every card
- GIVEN the same four appointments
- WHEN "Todas" is selected
- THEN all four cards MUST show **[unit]**

#### Scenario: Vencidas list row
- GIVEN a Vencida order on 2026-09-12 at 09:30
- WHEN the Vencidas tab renders
- THEN its row MUST show "12/09/2026 09:30" and the card fields, and MUST open the Detail when activated **[unit]**

#### Scenario: Vencidas list is capped and disclosed
- GIVEN 501 Vencida orders
- WHEN the page loads
- THEN at most 500 rows MUST be listed, a truncation notice MUST show and the badge MUST read 501 **[e2e]**

#### Scenario: Empty state
- GIVEN no Vencida order
- WHEN the Vencidas tab is selected
- THEN "Sin citas vencidas" MUST show **[unit]**

#### Scenario: Cancelled no-show leaves the tab
- GIVEN a Vencida order marked "No se presentó"
- WHEN the page refreshes
- THEN it MUST no longer be in the Vencidas tab, the badge MUST drop by one, and the order MUST show in the grid as a no-show **[e2e]**

#### Scenario: Tab survives a filter
- GIVEN a search text and the tab "Agendadas"
- WHEN staff switches to "Vencidas" and back
- THEN the search text MUST be unchanged and no request MUST have been sent **[unit]**

### Requirement: Search and Type Filter

The page header MUST offer a search field with placeholder "Buscar placa o cliente…" and the left column MUST offer a "Categoría" filter. Both are client-side over the loaded range (and over the Vencidas list); neither queries the server nor reaches beyond what is loaded, and neither changes the "En el taller ahora" list. Search MUST match the vehicle plate or the customer name, ignoring case, accents and (for the plate) spaces and hyphens, and an empty search matches everything. The filter lists the five types and "Sin categoría", each with a checkbox, a colour dot and a count of the loaded-range appointments of that type (counts do not change when checkboxes or search change), all checked by default; unchecking a type hides its cards; the "Todos" control re-checks all. The "Agendadas" badge MUST count only the cards left visible by search and filter; the Vencidas badge MUST stay the true total N. When nothing matches the grid MUST still render empty with the text "Sin resultados". The search field is reachable on a phone through the search control in the page bar.

#### Scenario: Search by plate
- GIVEN appointments with plates "AB 1234" and "CP 8812"
- WHEN staff types "ab1234"
- THEN only the "AB 1234" card MUST show **[unit]**

#### Scenario: Search by customer ignoring accents and case
- GIVEN customers "Sofía Herrera" and "Pedro Sánchez"
- WHEN staff types "sofia"
- THEN only "Sofía Herrera" MUST show **[unit]**

#### Scenario: Search covers the loaded range only
- GIVEN a matching plate on an appointment outside the visible range
- WHEN staff searches for it
- THEN no card MUST show and no request MUST be sent **[unit]**

#### Scenario: Type counts
- GIVEN 4 `revisado`, 2 `reparacion` and 2 untyped appointments in range
- WHEN the filter renders
- THEN it MUST show counts 4, 2 and 2 for "REVISADO", "Reparación" and "Sin categoría" and 0 for the others **[unit]**

#### Scenario: Unchecking hides a type
- GIVEN the filter with all checked
- WHEN staff unchecks "REVISADO"
- THEN no `revisado` card MUST show and the counts MUST be unchanged **[unit]**

#### Scenario: Todos resets
- GIVEN two types unchecked
- WHEN staff activates "Todos"
- THEN all six checkboxes MUST be checked **[unit]**

#### Scenario: Nothing matches
- GIVEN a search that matches nothing
- WHEN the grid renders
- THEN "Sin resultados" MUST show **[unit]**

#### Scenario: Shop list is unaffected
- GIVEN the combined view and a search that matches no appointment
- WHEN the page renders
- THEN "En el taller ahora" MUST still list every in-workshop order **[unit]**

### Requirement: Agenda Side Column

On `xl` width (1280) and up the page MUST render a left column with, in order: a mini calendar, the "Próxima cita" card, the "Categoría" filter and the "Esta semana" summary. Below `xl` the column MUST be hidden behind a "Filtros" button of at least 44x44 that opens it; on a phone the mini calendar is replaced by the day strip. 

Mini calendar: a Monday-first month grid with the month name and year, previous/next month controls, today marked, the selected day's Monday–Sunday week highlighted, and a dot under every day of the displayed month that has at least one appointment (by the inclusion rules of "Which Orders Appear"; an accessible text such as "con citas"). Day cells and month controls MUST be plain links rewriting `date` and keeping `view`; the month controls move to the 1st of the adjacent month. The dots MUST come from a lightweight query covering the displayed month's Panama range (Panama midnights, same scope), independent of the visible range and not subject to the range-query cap notice; it returns day keys only.

"Próxima cita": the earliest `booked` appointment whose `appointment_at` is at or after now (server clock at render), regardless of the visible range, showing "Próxima cita · en N min" (under 60 minutes), "en H h M min" (under 24 hours) or the digits `DD/MM/YYYY` (later), the time `HH:mm`, the customer name, `plate · make model` (or "Sin vehículo"), the description, an "Abrir orden" link and a `tel:` call button (each at least 44x44). It is computed at render and MUST NOT poll or tick; a manual refresh recomputes it. With no such appointment it MUST show "Sin citas próximas".

"Esta semana": the Monday–Sunday week of the selected date, whatever the view, with a count for each of "Agendadas" (booked, not Vencida), "Recibidas" (the in-workshop statuses and `done`, by appointment in that week), "Vencidas" (booked and Vencida, by appointment in that week) and "No se presentó" (no-shows in that week). These come from a lightweight count query over that week's Panama range, independent of the visible range.

#### Scenario: Mini calendar busy dots
- GIVEN a displayed month with appointments on the 2nd and the 5th only
- WHEN the mini calendar renders
- THEN exactly those two days MUST carry the busy dot and its accessible text **[unit]**

#### Scenario: Busy days are real
- GIVEN appointments on two days of a month and a cancelled-before-time order on a third
- WHEN the busy-days query runs against a real database
- THEN exactly the two days MUST be returned, using Panama days (an appointment at 23:30 Panama on day D belongs to D even when the database zone is UTC) **[e2e]**

#### Scenario: Mini calendar navigation
- GIVEN `view=week&date=2026-10-27`
- WHEN the mini calendar renders
- THEN day cells MUST be links like `/agenda?view=week&date=2026-10-xx`, the "next month" link MUST target `date=2026-11-01` and Monday 26 to Sunday 1 MUST be highlighted **[unit]**

#### Scenario: Próxima cita text
- GIVEN now = 10:40 and the earliest future booked appointment at 11:00
- WHEN the card renders
- THEN it MUST read "Próxima cita · en 20 min" with "11:00", the customer, the vehicle and the description **[unit]**

#### Scenario: Próxima cita beyond the visible range
- GIVEN the week view of a past week and the next booked appointment two weeks ahead
- WHEN the page loads
- THEN the card MUST show that appointment **[e2e]**

#### Scenario: Próxima cita ignores non-booked and past
- GIVEN a past booked, a future `open` and a future booked appointment
- WHEN the card is computed
- THEN it MUST pick the future booked one **[e2e]**

#### Scenario: Próxima cita is static
- GIVEN the rendered card
- WHEN time passes
- THEN no timer or interval MUST exist in the agenda files and the text MUST change only after a refresh **[unit]**

#### Scenario: Próxima cita empty
- GIVEN no future booked appointment
- WHEN the card renders
- THEN "Sin citas próximas" MUST show **[unit]**

#### Scenario: Week summary counts
- GIVEN in the selected week: 5 future booked, 2 Vencida, 3 received/done and 1 no-show appointments, and the `day` view of one of those days
- WHEN the summary is computed
- THEN it MUST read Agendadas 5, Vencidas 2, Recibidas 3 and No se presentó 1, not the day's own counts **[e2e]**

#### Scenario: Column collapses behind Filtros
- GIVEN the page at 768 px
- WHEN it renders
- THEN the left column MUST be hidden and a "Filtros" button of at least 44x44 MUST open it **[browser]**

## Out of Scope (recorded, not specified)

- Duration, capacity, overlap warnings, technician columns, a calendar library, a new write API, a new index, polling.
- **Existing reminder gap**: a booking made less than 24 h ahead gets no reminder at all (`reminders/schedule.ts` drops any plan already in the past). This change neither fixes nor depends on it; owners should know that a same-day or next-day appointment booked from the agenda will not be reminded.
- Reporting on no-shows or storing a no-show flag: the "Esta semana" count is derived from the `booked → cancelled` history row and `appointment_at`, nothing is persisted for it.
- Changing the board's whitelist or any `board.*` route.

## Assumptions made at spec level

1. Cards omit the description (proposal listed it as "excerpt?"; decided no).
2. Month range includes the leading/trailing days of the drawn weeks.
3. New Spanish strings that do not exist in code yet and are fixed here: "Agendar cita", "Cita agendada", "Cita reprogramada", "Usar ese cliente", "Vencida", "Vencidas" (tab), "Sin citas vencidas", "Sin citas para este día", "+N más", "Se muestran las primeras 500 citas; acotá el rango.", "Reprogramar", "No se presentó". Verified existing: "Orden cancelada" (`OrderStatusControls.tsx:43`), "Cliente creado" (`CustomerFormTrigger.tsx:53`), "Ver el cliente existente" and "Guardar igual" (`CustomerForm.tsx:572,585`), "Sin vehículo" (board/service-orders).
4. The 409/403 messages on the order PATCH are surfaced verbatim from the route (existing Spanish copy).
