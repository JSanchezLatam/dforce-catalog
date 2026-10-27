# Spec: workshop-agenda

New capability. One staff-only `/agenda` page that replaces the physical appointment board: day, week, month and combined views over `booked` orders, an overdue ("Vencida") rule with two actions, and a slim booking dialog with quick customer create. It reads existing order data and writes only through the existing order and customer APIs (no new write API, no migration).

Scenario tags: **[unit]** DB-free vitest; **[e2e]** needs real Postgres (anything whose value is a `WHERE`, a time-zone boundary, or a permission on the real path); **[browser]** only provable by opening the app (hydration, RSC boundary, 44px targets, phone/tablet layout, LAN IP).

Terms. "Panama day" = calendar day in `America/Panama` (UTC-5, no DST). "Appointment" = an `orden_servicio` with a non-null `appointment_at`. Status labels are the ones `ORDER_STATUS_LABEL` defines ("Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada", "Cancelada"). "In-workshop" statuses = `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`.

## ADDED Requirements

### Requirement: Agenda Access

The system MUST define the action `agenda.manage`, allowed for `administrador` and `jefe_taller` and denied for `tecnico` and `pantalla`. `/agenda` MUST check `can(user, "agenda.manage")` in the page itself and MUST have a `ROUTE_GUARDS` entry. A denied authenticated request MUST render `PermissionDenied` (not a redirect) and MUST NOT query agenda data. A request with no valid session MUST redirect to `/login`. For `pantalla` the application layout MUST redirect to `/tablero/clientes` before the page renders (existing behaviour of the `(app)` shell; the page function itself still answers `PermissionDenied` if reached). The sidebar MUST show an "Agenda" link to `/agenda` only to roles holding `agenda.manage`. The agenda MUST add no new API route: its writes go through `PATCH /api/service-orders/[id]`, `POST /api/service-orders` and `POST /api/customers`, whose own permission checks are unchanged.

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
- GIVEN `src/app/agenda/page.tsx`
- WHEN `route-guards.test.ts` runs
- THEN it MUST find a `ROUTE_GUARDS` entry quoting `agenda.manage` and a literal `can(user, "agenda.manage")` in the page, and MUST fail if either is removed **[unit]**

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

For the visible range the page MUST load appointments whose `appointment_at` lies in the half-open interval [Panama 00:00 of the first visible day, Panama 00:00 of the day after the last visible day), computed in `America/Panama` regardless of the server or database session zone. Ranges: `day` and `combined` = the selected day; `week` = Monday through Sunday of the selected day's week; `month` = every week-row the month grid draws (full Monday-start weeks, so leading and trailing days of adjacent months are inside the range). The query MUST join `cliente` and left-join `vehiculo`, MUST need no new index, and MUST be capped at 500 rows (ordered by `appointment_at` ascending, then id). When the cap truncates the range the page MUST say so with a visible notice, never silently drop rows. The query MUST be scoped by the existing `OrderScope`.

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

### Requirement: Which Orders Appear

An order MUST appear on the agenda only when `appointment_at` is non-null and falls in the visible range, subject to its status: `booked` MUST appear as an actionable appointment; `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review` and `done` MUST appear muted with a status badge carrying the `ORDER_STATUS_LABEL` text and MUST carry no Reprogramar or "No se presentó" action; `cancelled` MUST NOT appear. A muted chip MUST remain a link to the order's detail page.

#### Scenario: Status visibility
- GIVEN one order in each of the eight statuses, all with an appointment inside the range
- WHEN the range query runs
- THEN seven MUST be returned and the `cancelled` one MUST NOT **[e2e]**

#### Scenario: Booked is actionable, later statuses are muted
- GIVEN a `booked` and an `open` appointment
- WHEN the chips render
- THEN the booked chip MUST offer its actions and the open chip MUST be visually muted, show the badge "Recibida" and offer no action **[unit]**

#### Scenario: Order without an appointment is absent
- GIVEN a `booked` or `open` order with null `appointment_at`
- WHEN any view loads
- THEN it MUST NOT appear in the grid **[e2e]**

### Requirement: Chip Content

Every appointment chip MUST show, in this order: the time as `HH:mm` (24-hour, Panama time, digits and a colon only), the customer name, the customer phone, and the vehicle plate or, when the order has no vehicle, the text "Sin vehículo". Chips MUST NOT show the description or any excerpt of it (decision: it is free text, unbounded in length and unnecessary to place a car on the calendar; it stays on the order detail). A chip MUST be a link to `/service-orders/<id>`. Chip text MUST wrap rather than clip in narrow columns (long names and phone numbers such as `+50761234567`). Chips within a day MUST be ordered by start time ascending; appointments at the same or overlapping times MUST all render, stacked, none hidden or overwritten. There is no duration, capacity or technician concept.

#### Scenario: Chip fields
- GIVEN a booked order for customer "Pérez", phone "61234567", plate "AB1234" at 14:05 Panama
- WHEN its chip renders
- THEN it MUST show "14:05", "Pérez", "61234567" and "AB1234" and MUST NOT show the order description **[unit]**

#### Scenario: Booked order without a vehicle
- GIVEN a booked order with null vehicle
- WHEN its chip renders
- THEN it MUST show "Sin vehículo" in place of the plate and MUST NOT throw **[unit]**

#### Scenario: Overlap stacks
- GIVEN three appointments at 09:00 on the same day
- WHEN the day renders
- THEN all three chips MUST be present, in a stable order (start time, then id) **[unit]**

#### Scenario: Time text is identical on server and client
- GIVEN an appointment at 2026-10-26T19:05:00Z
- WHEN the time text is formatted anywhere in the module
- THEN it MUST read "14:05" using a digit-only formatter and MUST NOT use `toLocaleString`/`Intl` locale text in any `"use client"` file **[unit]**

### Requirement: Day, Week and Month Layout

Views MUST be a hand-rolled CSS grid rendered by a server component (no calendar library, no new dependency). `day`: one column of chips for the selected day. `week`: seven day columns Monday to Sunday on tablet and wider, each headed by weekday and day number; on a phone width the week MUST collapse to a vertical list of days (never a horizontally scrolling page). `month`: a Monday-first grid of week rows; each cell shows the day number and at most 3 chips ordered by time; when a day has more, the cell MUST show a link "+N más" (N = the hidden count) that opens the `day` view for that date. Days outside the month MUST be drawn visually dimmed but still carry their chips. Today's Panama day MUST be marked. Every day cell and every "+N más" link MUST be a link or control of at least 44x44.

#### Scenario: Month cell cap
- GIVEN a day with 5 appointments
- WHEN the month view renders
- THEN the cell MUST show the first 3 chips by time and a link "+2 más" to `/agenda?view=day&date=<that day>` **[unit]**

#### Scenario: Exactly three chips show no overflow link
- GIVEN a day with exactly 3 appointments
- WHEN the month view renders
- THEN no "+N más" link MUST render **[unit]**

#### Scenario: Singular and plural are not special-cased
- GIVEN a day with 4 appointments
- WHEN the month view renders
- THEN the link MUST read "+1 más" **[unit]**

#### Scenario: Empty day
- GIVEN a day with no appointments
- WHEN the day view renders
- THEN it MUST show the explicit empty state "Sin citas para este día" **[unit]**

#### Scenario: Tablet and phone layouts
- GIVEN each view opened on a tablet width (about 768 px) and a 390 px phone at the LAN IP
- WHEN rendered with realistic data
- THEN no view MUST scroll the page horizontally, week MUST collapse to a day list on the phone, and chips MUST stay legible **[browser]**

#### Scenario: Hit targets
- GIVEN chips, month day cells, "+N más" links and the action buttons
- WHEN rendered on a touch device
- THEN each MUST measure at least 44x44 **[browser]**

### Requirement: Combined View

The `combined` view MUST show, for the selected day, that day's appointments (same chips and rules as the day view) together with all orders currently in the workshop. The in-workshop set MUST be every order whose current status is `open`, `diagnosing`, `in_progress`, `on_hold` or `ready_for_review`, regardless of any appointment date or the selected day. Each in-workshop row MUST show the status badge ("Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión"), the customer name, the customer phone, the plate or "Sin vehículo", and, only while `on_hold`, the hold reason label, and MUST link to the order. `done` and `cancelled` and `booked` MUST NOT be in the in-workshop list. On wide screens the two lists MUST sit side by side; on a phone they MUST be stacked (appointments first, then in-workshop). The in-workshop query MUST live in `src/modules/agenda/`, not in `src/modules/board/queries.ts`, and MUST be capped like the range query.

The agenda is a staff-only surface and MAY carry customer name and phone. This does NOT relax the workshop status board: the board's field whitelist, the `board.*` payloads and the rule that board queries never join `cliente` MUST remain unchanged.

#### Scenario: In-workshop set
- GIVEN one order in each of the eight statuses
- WHEN the combined view loads
- THEN the in-workshop list MUST contain exactly the five in-workshop statuses, independent of the selected date **[e2e]**

#### Scenario: Hold reason shown only while on hold
- GIVEN an `on_hold` order with reason `repuesto` and an `in_progress` order
- WHEN the in-workshop rows are built
- THEN the first MUST carry the Spanish hold-reason label and the second MUST carry none **[unit]**

#### Scenario: Selected day and live orders together
- GIVEN a booked appointment on the selected day and an `in_progress` order created for another day
- WHEN the combined view renders
- THEN both MUST be visible on the page **[e2e]**

#### Scenario: Side by side and stacked
- GIVEN the combined view
- WHEN opened on a wide screen and on a 390 px phone at the LAN IP
- THEN the lists MUST be side by side on the wide screen and stacked on the phone without horizontal page scroll **[browser]**

#### Scenario: Board payload still carries no customer data
- GIVEN a database whose orders belong to a customer named with a sentinel name and phone
- WHEN `GET /api/board` and `GET /api/board/clientes` are called after this change
- THEN neither body MUST contain the sentinel name or phone, and `src/modules/board/queries.ts` MUST still not reference `cliente` **[e2e]**

### Requirement: Vencida Rule

A `booked` order MUST be Vencida when `appointment_at < now − 60 minutes`; the margin MUST be a single exported constant (`OVERDUE_MARGIN_MINUTES = 60`) used by every caller, and the comparison MUST be strict (an appointment exactly 60 minutes old is not yet Vencida). A non-`booked` order is never Vencida. The flag MUST be computed on the server from a server clock and passed to client components as a plain boolean; the client MUST NOT compute it. A Vencida chip MUST carry the visible label "Vencida" in addition to any colour, so it does not rely on colour alone.

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

### Requirement: Vencidas Panel

On every view (`day`, `week`, `month`, `combined`) the page MUST render a panel headed "Vencidas (N)" listing every Vencida order irrespective of the visible range or selected date, ordered by `appointment_at` ascending (oldest first), each row showing the chip fields, its full Panama date as digits (`DD/MM/YYYY HH:mm`) and the two actions of the next requirement. N MUST be the true number of Vencida orders. The list MUST be capped at 500 rows with a disclosure notice when truncated. With N = 0 the panel MUST render the empty state "Sin citas vencidas" (or be omitted only if the layout cannot carry it; the heading count is never hidden).

#### Scenario: Old overdue appointment never disappears
- GIVEN a booked appointment 40 days ago and the week view of the current week
- WHEN the page loads
- THEN the order MUST appear in "Vencidas (1)" **[e2e]**

#### Scenario: Panel on every view
- GIVEN one Vencida order
- WHEN each of the four views renders
- THEN each MUST show "Vencidas (1)" **[unit]**

#### Scenario: Count is the true count
- GIVEN 3 Vencida orders, one of them inside the visible range
- WHEN the page renders
- THEN the heading MUST read "Vencidas (3)" and list all three **[e2e]**

#### Scenario: Cancelled no-show leaves the panel
- GIVEN a Vencida order marked "No se presentó"
- WHEN the page refreshes
- THEN it MUST no longer be in the panel and the count MUST drop by one **[e2e]**

### Requirement: Reprogramar

The actions of this requirement and of "No se presentó" MUST render on the chips of the `day` view, on the `combined` view's day list and on every row of the Vencidas panel, and MUST NOT render on `week` or `month` chips: those columns are about 90 px wide at tablet width and the buttons spill into the neighbouring day (browser check, 2026-10). The panel is on every view, so every Vencida order stays actionable from any view. A `booked` appointment (including a Vencida one) MUST offer "Reprogramar", opening a dialog with a day field and an `HH:mm` time field prefilled from the current appointment (in Panama time, from server-provided digit-only text). On submit the client MUST send `PATCH /api/service-orders/[id]` with `{ appointmentAt }` as an ISO-8601 string built from the chosen day and time with the explicit offset `-05:00`; it MUST NOT use the browser's local time zone, `datetime-local`, or `Date` parsing of the local zone. The system MUST rely on the existing reminder behaviour: the pending `appointment` reminder is cancelled and a new one planned for the new time. On success the dialog MUST close, the toast "Cita reprogramada" MUST be added above `router.refresh()` and both MUST sit below the `try/catch`. A refusal (403/409/400) MUST show the route's Spanish message inline in the dialog and MUST NOT toast success or close the dialog. The submit button MUST be disabled while the request is in flight. A day or time left empty MUST be rejected client-side with a Spanish message, without a request.

#### Scenario: Request body
- GIVEN the dialog with day 2026-10-30 and time 15:30
- WHEN staff submits
- THEN the PATCH body MUST be `{ "appointmentAt": "2026-10-30T15:30:00-05:00" }` from a browser in any time zone **[unit]**

#### Scenario: Reschedule persists and replans the reminder
- GIVEN a booked order with a pending `appointment` reminder
- WHEN the PATCH is applied
- THEN `appointment_at` MUST equal the new instant, the old pending reminder MUST be cancelled and a new one planned (when the new time is at least 24 h ahead) **[e2e]**

#### Scenario: Success feedback
- GIVEN a successful PATCH
- WHEN the dialog finishes
- THEN the toast "Cita reprogramada" MUST show once and the grid MUST refresh **[unit]**

#### Scenario: Order no longer booked
- GIVEN the order was received in another session after the page loaded
- WHEN staff submits the dialog
- THEN the route's refusal message MUST appear inline, no success toast MUST show and the dialog MUST stay open **[unit]**

#### Scenario: Week and month chips carry no actions
- GIVEN booked and Vencida appointments in the week and month views
- WHEN the chips render
- THEN no Reprogramar or "No se presentó" control MUST render on them, and the Vencidas panel MUST still offer both for each Vencida order **[unit]**

#### Scenario: Reprogramar not offered to a muted chip
- GIVEN an `open` appointment
- WHEN its chip renders
- THEN no Reprogramar control MUST render **[unit]**

### Requirement: No se presentó

A `booked` appointment that is Vencida MUST offer "No se presentó". Clicking it MUST open a confirmation (copy states that the order will be cancelled) before any request; confirming MUST send `PATCH /api/service-orders/[id]` with `{ status: "cancelled", expectedStatus: "booked" }`. The route MUST accept an optional `expectedStatus` on a status transition and, under the existing row lock, refuse with 409 and the Spanish message "La orden cambió mientras la mirabas. Actualizá la agenda." when the locked status differs, writing nothing. Cancelling is terminal, so without this a stale screen could cancel an order that was received in the meantime. A transition without `expectedStatus` MUST behave exactly as today. It is an ordinary cancellation: no reason is asked, no counter or no-show flag is stored, and the existing cancellation side effects apply unchanged (pending reminders cancelled, a `booked → cancelled` history row written). On success the toast MUST be "Orden cancelada" (the existing copy of `OrderStatusControls`'s `successMessage` for a `cancelled` target), placed above `router.refresh()` and below the `try/catch`. If the order changed concurrently (409, or a refusal because its status no longer permits cancellation), the route's Spanish message MUST be surfaced inline in the confirmation, no success toast MUST show and the dialog MUST stay open until dismissed. The submit button MUST be disabled while in flight.

#### Scenario: Stale no-show is refused
- GIVEN a Vencida booked order on a screen, and another operator receives it (`booked → open`) before the click
- WHEN "No se presentó" is confirmed
- THEN the PATCH MUST answer 409 "La orden cambió mientras la mirabas. Actualizá la agenda.", the order MUST stay `open`, no history row MUST be written and no toast MUST show **[e2e]**

#### Scenario: Transitions without expectedStatus are unchanged
- GIVEN any existing status PATCH without `expectedStatus`
- WHEN it is sent
- THEN it MUST behave exactly as before this change **[unit]**

#### Scenario: Confirmation precedes the request
- GIVEN a Vencida chip
- WHEN staff clicks "No se presentó"
- THEN no request MUST be sent until the confirmation is accepted; dismissing sends nothing **[unit]**

#### Scenario: Cancels as an ordinary cancellation
- GIVEN a Vencida booked order with a pending reminder
- WHEN the confirmed PATCH is applied
- THEN the status MUST be `cancelled`, the pending reminder MUST be cancelled, exactly one `booked → cancelled` history row MUST exist and no other column MUST record a no-show **[e2e]**

#### Scenario: Success feedback
- GIVEN a successful cancellation
- WHEN the dialog finishes
- THEN the toast "Orden cancelada" MUST show and the order MUST leave the grid and the Vencidas panel **[unit]**

#### Scenario: Concurrent change surfaces inline
- GIVEN the order was received (or cancelled) by someone else after the page loaded
- WHEN staff confirms
- THEN the route's Spanish message MUST appear inline, no success toast MUST show **[unit]**

#### Scenario: Not offered where it does not apply
- GIVEN a booked appointment that is not yet Vencida, and a non-booked appointment
- WHEN their chips render
- THEN neither MUST offer "No se presentó" **[unit]**

### Requirement: Booking Dialog

The agenda MUST offer a "Agendar cita" control opening a slim dialog with: a customer picker (reusing `CustomerPicker`, its existing props staying backward compatible for `ServiceOrderForm`), a day field, an `HH:mm` time field and a description. Vehicle, category and technician MUST NOT be asked (a booked order may omit them). On submit the client MUST send `POST /api/service-orders` with `status: "booked"`, the chosen `clienteId`, `description` and `appointmentAt` built from day and time with the explicit offset `-05:00`. When opened from a day (day view, a month/week day cell control, or "+N más" context), the day field MUST be prefilled with that Panama day; when opened from the page header it MUST default to the selected `date`. Customer, day and time are required and an empty one MUST be rejected client-side with a Spanish message. On success the dialog MUST close, the toast "Cita agendada" MUST be added above `router.refresh()` and below the `try/catch`, and the new chip MUST appear in its cell without a manual reload. A server rejection MUST show its Spanish message inline and keep the dialog open. The dialog MUST NOT use `crypto.randomUUID` or any secure-context-only API, and MUST NOT format dates with locale text on the client. A day with no vehicle MUST yield an order that appears on the agenda as "Sin vehículo".

#### Scenario: Request body
- GIVEN customer C, day 2026-11-02, time 09:00 and a description
- WHEN staff submits
- THEN the POST body MUST carry `status: "booked"`, `clienteId: C`, the description and `appointmentAt: "2026-11-02T09:00:00-05:00"`, and no vehicle, category or technician **[unit]**

#### Scenario: Persists as booked without vehicle
- GIVEN that POST
- WHEN it is applied
- THEN a `booked` order with null vehicle and category, the chosen appointment instant and one `null → booked` history row MUST exist, and a reminder MUST be planned when the time is at least 24 h ahead **[e2e]**

#### Scenario: Prefilled day
- GIVEN the dialog opened from the cell of 2026-11-05
- WHEN it renders
- THEN the day field MUST read 2026-11-05 **[unit]**

#### Scenario: Required fields
- GIVEN no customer, or no day, or no time
- WHEN staff submits
- THEN a Spanish validation message MUST show and no request MUST be sent **[unit]**

#### Scenario: Success feedback
- GIVEN a successful POST
- WHEN the dialog finishes
- THEN the toast "Cita agendada" MUST show once and the new chip MUST be visible on its day **[browser]**

#### Scenario: Server rejection stays inline
- GIVEN a POST the server rejects
- WHEN the response arrives
- THEN the message MUST appear in the dialog, no toast MUST show and the dialog MUST stay open **[unit]**

#### Scenario: Works over plain HTTP on the LAN
- GIVEN the booking dialog opened at `http://<lan-ip>:3000` from a second machine
- WHEN staff books an appointment
- THEN it MUST complete with no console error and no use of a secure-context-only API **[browser]**

### Requirement: Quick Customer Create

The customer picker inside the booking dialog MUST offer a slim "create customer" form with only name and phone (no opt-out fields, no other customer fields), submitting `POST /api/customers`. The server's validation (name required; phone 7–15 digits) MUST be surfaced inline per field. On 201 the new customer MUST become the picker's selected customer, the toast "Cliente creado" MUST show (above `router.refresh()` where a refresh exists, below the `try/catch`), and the booking dialog MUST stay open with its other fields untouched. The quick form MUST be nested in the booking dialog without ever submitting the outer form: its submit handler MUST call `event.preventDefault()` and `event.stopPropagation()`, and the form MUST NOT be a DOM descendant `<form>` of the outer one (or must portal out) so that Enter in a quick-form field never submits the booking.

On `409 { error: "duplicate_phone", existingClienteId }` the form MUST offer three choices: "Ver el cliente existente" (shows the existing customer's name and details, fetched with `GET /api/customers?search=<phone>`, without leaving the dialog), "Usar ese cliente" (selects the existing customer in the picker and closes the quick form, creating nothing) and "Guardar igual" (resubmits with `allowDuplicatePhone: true`, creating a second customer with the same phone). While a duplicate is shown, the primary create button MUST NOT be a way to create silently. If the lookup shows the existing customer is deactivated, "Usar ese cliente" MUST NOT be clickable (an order needs an active customer; `POST /api/service-orders` answers 409 `cliente_deactivated`) and a Spanish note MUST say so; "Guardar igual" stays available, because creating a new customer that shares a phone with a deactivated one is allowed (`POST /api/customers` has no `cliente_deactivated` refusal — that 409 exists only on edit, `api/customers/[id]/route.ts:139`). Both buttons MUST be disabled while a request is in flight.

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
- GIVEN every file under `src/modules/agenda/` and `src/app/agenda/`
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

## Out of Scope (recorded, not specified)

- Duration, capacity, overlap warnings, technician columns, a calendar library, a new write API, a new index, polling.
- **Existing reminder gap**: a booking made less than 24 h ahead gets no reminder at all (`reminders/schedule.ts` drops any plan already in the past). This change neither fixes nor depends on it; owners should know that a same-day or next-day appointment booked from the agenda will not be reminded.
- Counting or reporting no-shows.
- Changing the board's whitelist or any `board.*` route.

## Assumptions made at spec level

1. Chips omit the description (proposal listed it as "excerpt?"; decided no).
2. Month range includes the leading/trailing days of the drawn weeks.
3. New Spanish strings that do not exist in code yet and are fixed here: "Agendar cita", "Cita agendada", "Cita reprogramada", "Usar ese cliente", "Vencida", "Vencidas (N)", "Sin citas vencidas", "Sin citas para este día", "+N más", "Se muestran las primeras 500 citas; acotá el rango.", "Reprogramar", "No se presentó". Verified existing: "Orden cancelada" (`OrderStatusControls.tsx:43`), "Cliente creado" (`CustomerFormTrigger.tsx:53`), "Ver el cliente existente" and "Guardar igual" (`CustomerForm.tsx:572,585`), "Sin vehículo" (board/service-orders).
4. The 409/403 messages on the order PATCH are surfaced verbatim from the route (existing Spanish copy); the exact message for a status-transition conflict was not re-read beyond `OrderTransitionError` handling.
