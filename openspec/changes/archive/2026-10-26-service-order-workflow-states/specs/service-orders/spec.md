# Delta Spec: service-orders

The order gains the states Agendada (`booked`), En diagnóstico (`diagnosing`) and En espera (`on_hold`), `open` is relabeled "Recibida", and a técnico's `open → in_progress` exception is removed. Tag **[e2e]** = value is SQL (CHECKs, history rows, auto-transitions, joins/count parity, locking) and MUST be proven against a real Postgres; **[unit]** = pure; **[LAN]** = browser check at the LAN IP. Every MODIFIED block below is the full requirement, restated.

Status labels: `booked` "Agendada", `open` "Recibida", `diagnosing` "En diagnóstico", `in_progress` "En progreso", `on_hold` "En espera", `ready_for_review` "Lista para revisión", `done` "Completada", `cancelled` "Cancelada".

## MODIFIED Requirements

### Requirement: Service Order Creation (R20)

The system MUST allow an `administrador` or a `jefe_taller` to create an `orden_servicio` that references exactly one existing `cliente`, ZERO or more assigned technicians (active roster rows; reception happens before assignment, so none is required), and an optional `observaciones` string. The creator MUST choose the initial status: Agendada (`booked`) or Recibida (`open`, the default, for a walk-in); any other initial status MUST be refused. A Recibida order MUST also reference exactly one existing `vehiculo` belonging to that same `cliente` and a `categoria`. An Agendada order MUST require `appointmentAt` and MAY omit `vehiculo` and `categoria` (see Booked Order Without Vehicle or Category); when it names them, the same ownership rules apply. A `tecnico` MUST NOT create orders: the create route MUST refuse them with 403 and the create control MUST NOT render for them. Creation MUST NOT accept `producto` line items. `orden_servicio.vehiculoId` MUST be a foreign key to `vehiculo` with `ON DELETE RESTRICT`. Any supplied assignments MUST be written in the same transaction as the order; a Recibida order created with at least one technician MUST end that transaction in `diagnosing`, with a history row for each step (see `service-order-status-history`), while an Agendada order stays `booked`. An order with no assignment is visible to administrador and jefe only until one of them assigns it later. A deactivated or unknown technician MUST be refused. `hallazgos` and `recomendaciones` MUST NOT be settable at creation — see the Category and Completion Notes Editing requirement. `ordenServicioItem` has no writer once this requirement ships: no code path inserts a line item for any order, so every order's "Piezas utilizadas" detail card renders its empty state permanently. The table and the card both remain in place, for existing rows and a future recording-parts-used flow.
(Previously: always created in `open`; vehicle and category always required; vehiculoId NOT NULL; no automatic diagnosing.)

#### Scenario: Order created with no parts, an optional categoria and observaciones
- GIVEN an existing `cliente` with an active `vehiculo` and an active technician
- WHEN an administrador or jefe creates a service order naming that vehicle, a `categoria` and that technician
- THEN the system MUST create the order referencing that vehicle and category, with no line items and one assignment (its status follows the scenarios below)

#### Scenario: Walk-in with a technician lands in diagnosing **[e2e]**
- GIVEN a Recibida create payload naming an active technician
- WHEN an administrador or jefe submits it
- THEN the order MUST end in `diagnosing` with one assignment and two history rows (null → `open`, `open` → `diagnosing`)

#### Scenario: Order may be created with no technician **[e2e]**
- GIVEN a Recibida create payload with no technician
- WHEN an administrador or jefe submits it
- THEN the system MUST create the order in `open` with zero assignments and one history row, and a later assignment MUST be possible

#### Scenario: Agendada created without vehicle or category **[e2e]**
- GIVEN an `appointmentAt`, a `cliente`, and no vehicle or category
- WHEN an administrador or jefe creates the order as Agendada
- THEN the order MUST persist in `booked` with null vehicle and category and one history row (null → `booked`)

#### Scenario: Agendada with a technician stays booked **[e2e]**
- GIVEN an Agendada payload naming an active technician
- WHEN it is submitted
- THEN the order MUST be `booked` with one assignment and no `diagnosing` row

#### Scenario: Agendada requires a date
- GIVEN an Agendada payload with no `appointmentAt`
- WHEN it is submitted
- THEN the system MUST reject it with a Spanish validation error and create nothing

#### Scenario: Recibida without vehicle or category rejected
- GIVEN a Recibida payload with no `vehiculoId`, or no `categoria`
- WHEN it is submitted
- THEN the system MUST reject it with a Spanish validation error and create nothing

#### Scenario: Other initial statuses refused
- GIVEN a create payload whose initial status is `in_progress`, `done` or `diagnosing`
- WHEN it is submitted
- THEN the system MUST reject it and create nothing

#### Scenario: Deactivated technician refused
- GIVEN a deactivated technician
- WHEN an administrador creates an order assigning them
- THEN the system MUST reject creation with a Spanish message and create nothing

#### Scenario: Técnico cannot create
- GIVEN a `tecnico` session
- WHEN it sends a create-order request or opens the orders list
- THEN the route MUST answer 403 and no order MUST be created, and the list MUST NOT render a create control

#### Scenario: Invalid cliente rejected
- GIVEN a `cliente` id that does not exist
- WHEN staff attempts to create a service order against it
- THEN the system MUST reject creation with a validation error

#### Scenario: Invalid vehiculoId rejected
- GIVEN a `vehiculoId` that does not correspond to any `vehiculo` row
- WHEN staff attempts to create a service order naming it
- THEN the system MUST reject creation with a Spanish validation error and MUST NOT create the order

#### Scenario: Cross-ownership rejected
- GIVEN a `vehiculo` belonging to customer B
- WHEN staff attempts to create an order with `clienteId` set to customer A and that vehicle
- THEN the system MUST reject creation with a Spanish validation error

#### Scenario: Customer with zero active vehicles blocks Recibida only
- GIVEN a `cliente` with zero active vehicles
- WHEN staff opens the order-creation form for that customer
- THEN the vehicle picker MUST offer no selectable vehicle and submitting as Recibida MUST be prevented, while submitting as Agendada MUST remain possible

#### Scenario: Observaciones persists from creation
- GIVEN a create payload with `observaciones = "trae ruido al frenar"`
- WHEN the order is created
- THEN the system MUST persist that value on the new order

#### Scenario: A new order's Piezas card always shows its empty state
- GIVEN an order created after this requirement ships
- WHEN staff opens its detail view
- THEN the "Piezas utilizadas" card MUST render its empty state

### Requirement: Status Lifecycle Transitions (R21)

An `orden_servicio` MUST have one of eight statuses (labels above). The ONLY valid transitions are: `booked → open`, `open → diagnosing`, `diagnosing → in_progress`, `in_progress → on_hold`, `on_hold → in_progress`, `in_progress → ready_for_review`, `ready_for_review → in_progress`, `in_progress → done`, `ready_for_review → done`, and `cancelled` from every non-terminal status (`booked`, `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`). `done` and `cancelled` MUST be terminal — no transition out of either is valid. Nothing MUST transition INTO `booked`. Every other pair MUST be rejected, in particular `open → in_progress`, `open → done`, `open → ready_for_review`, `diagnosing → done`, `diagnosing → ready_for_review`, `on_hold → done` and `on_hold → ready_for_review`: the flow always passes diagnosing.

Two transitions are automatic and the manual transition route MUST reject them as targets: `open → diagnosing` happens ONLY when the first technician is assigned to a Recibida order, or when a Recibida order is created with one (see Order Assignment); `in_progress → ready_for_review` happens ONLY as the consequence of the last "Mi parte lista" mark (see `order-work-lines`). `ready_for_review → in_progress` happens when a técnico un-marks, when a technician is assigned to the order, or by an administrador or jefe through the transition route ("devolver"). Sending an order back through the transition route MUST clear `parte_lista_at` on every one of its assignments in the same transaction, so each technician marks again after the rework; an un-mark or an assignment clears only what its own rule says. Putting an order on hold and resuming it MUST NOT clear any `parte_lista_at`.

`booked → open` ("Recibir") MUST be refused while the order lacks a vehicle or a `categoria`. When it succeeds on an order that already has at least one technician assigned, the same transaction MUST continue `open → diagnosing`.

Who may transition manually: ONLY an `administrador` or `jefe_taller` (the holders of `service-orders.assign`), for every target, including `diagnosing → in_progress`, entering and leaving `on_hold`, `done` and `cancelled`. A `tecnico` MUST NOT perform any manual transition, including the former `open → in_progress`; the technician's only status effects are the readiness marks. `done` is reachable only from `in_progress` and `ready_for_review`, regardless of marks. Every transition MUST record the timestamp at which it occurred, and `done` MUST also set `completedAt`.
(Previously: five statuses; `open → in_progress` valid and performable by an assigned técnico; no `booked`, `diagnosing` or `on_hold`; only `in_progress` and `ready_for_review` could be cancelled besides `open`.)

#### Scenarios

- GIVEN an order in `booked` with a vehicle and category WHEN an administrador or jefe receives it THEN the status MUST become `open` and the transition timestamp MUST be recorded **[e2e]**
- GIVEN a `booked` order with no vehicle or no `categoria` WHEN an administrador receives it THEN the system MUST refuse with a Spanish message, MUST NOT answer 500 and the status MUST stay `booked` **[e2e]**
- GIVEN a `booked` order with a vehicle, a category and one technician assigned WHEN an administrador receives it THEN the order MUST end in `diagnosing` with history rows `booked → open` and `open → diagnosing` **[e2e]**
- GIVEN an order in `open` WHEN anyone transitions it to `in_progress`, `done` or `ready_for_review` THEN the system MUST reject it as an invalid transition
- GIVEN an order in `open` or any other status WHEN anyone calls the transition route with target `diagnosing` THEN the system MUST reject it
- GIVEN an order in `diagnosing` WHEN an administrador or jefe transitions it to `in_progress` THEN the system MUST accept it and write a history row **[e2e]**
- GIVEN an order in `diagnosing` WHEN a `tecnico` assigned to it transitions it to `in_progress` THEN the system MUST refuse with 403 and the status MUST stay `diagnosing`
- GIVEN an order in `diagnosing` WHEN anyone transitions it to `done` or `ready_for_review` THEN the system MUST reject it
- GIVEN an order in `in_progress` WHEN an administrador or jefe puts it on hold with a reason THEN the status MUST become `on_hold` (reason rules: see On-Hold Reason)
- GIVEN an order in `on_hold` WHEN an administrador or jefe resumes it THEN the status MUST become `in_progress` with every `parte_lista_at` unchanged **[e2e]**
- GIVEN an order in `on_hold` WHEN anyone transitions it to `done` or `ready_for_review` THEN the system MUST reject it
- GIVEN an assigned `tecnico` WHEN they put an order on hold or resume it THEN the system MUST refuse with 403 and change nothing
- GIVEN an order in `in_progress` WHEN an administrador or jefe transitions it to `done` THEN the system MUST update its status, set `completedAt` and record the transition timestamp
- GIVEN an order in `ready_for_review` WHEN an administrador or jefe transitions it to `done` THEN the system MUST accept it
- GIVEN an order in `in_progress` or `ready_for_review` with unmarked technicians WHEN an administrador or jefe closes it THEN the system MUST accept it
- GIVEN an order in `in_progress` WHEN anyone calls the transition route with target `ready_for_review` THEN the system MUST reject it as an invalid transition
- GIVEN an order in `ready_for_review` WHEN an administrador or jefe transitions it to `in_progress` THEN the system MUST accept it AND every assignment's `parte_lista_at` MUST be null afterwards **[e2e]**
- GIVEN an order sent back to `in_progress` WHEN every active assignee marks "Mi parte lista" again THEN the order MUST become `ready_for_review` again
- GIVEN an assigned `tecnico` WHEN they transition an order to `done` or `cancelled` THEN the system MUST refuse with 403 and change nothing
- GIVEN an order in `booked`, `open`, `diagnosing`, `in_progress`, `on_hold` or `ready_for_review` WHEN an administrador or jefe cancels it THEN the system MUST set its status to `cancelled` and write a history row **[e2e]**
- GIVEN a `booked` order with no vehicle and no category WHEN an administrador or jefe cancels it (a no-show) THEN the system MUST accept it **[e2e]**
- GIVEN an order in `done` or `cancelled` WHEN staff attempts any further transition THEN the system MUST reject it because the status is terminal
- GIVEN any order WHEN anyone transitions it to `booked` THEN the system MUST reject it
- GIVEN the full status list **[unit]** WHEN the allowed-transition table is read THEN it MUST equal exactly the pairs above, each non-listed pair MUST be rejected

### Requirement: Reception Photos

An order MUST hold up to 12 reception photos, stored as JPEG in object storage under `service-orders/<ordenId>/<photoId>.jpg` with a server-generated id, listed by `position` ascending. The server MUST accept a file only if its leading bytes are a JPEG signature (the declared content type MUST NOT be trusted) and its size is at most 3 MB. Photo bytes MUST be served only through an authenticated same-origin route to sessions holding `service-orders.read`; a `tecnico` MUST be served photos only of orders assigned to them (any other order answers 404). Adding MUST be allowed while the order is `booked`, `open`, `diagnosing` or `in_progress` to any role holding `service-orders.write` (a `tecnico` only on an order assigned to them), while `on_hold` or `ready_for_review` only to an `administrador` or `jefe_taller`, and refused when `done` or `cancelled` unless it is an authorized administrator correction (see `service-order-corrections`). Deleting MUST be allowed only to `administrador` while `booked`, `open`, `diagnosing`, `in_progress`, `on_hold` or `ready_for_review`, or while `done` or `cancelled` under an authorized administrator correction; any other role (including `jefe_taller`) MUST receive 403, and a closed-order delete without an authorized correction MUST be refused. Photos MUST never be removed by retention. The order detail MUST show a "Fotos de recepción" card.
(Previously: add allowed in `open`/`in_progress`; admin/jefe-only in `ready_for_review`; delete allowed in `open`, `in_progress`, `ready_for_review`.)

#### Scenario: Valid JPEG added
- GIVEN an `open` order with 0 photos and a session with `service-orders.write`
- WHEN a valid 500 KB JPEG is uploaded
- THEN the system MUST store it at position 0 and list it

#### Scenario: Non-JPEG refused
- GIVEN a PNG, or a non-image file labelled `image/jpeg`
- WHEN it is uploaded
- THEN the system MUST refuse it with a Spanish message and store nothing

#### Scenario: Oversize refused
- GIVEN a valid JPEG larger than 3 MB
- WHEN it is uploaded
- THEN the system MUST refuse it with a Spanish message

#### Scenario: Thirteenth photo refused
- GIVEN an order with 12 photos
- WHEN a 13th is uploaded
- THEN the system MUST refuse it with a Spanish message and the order MUST still hold 12

#### Scenario: Ordered by position
- GIVEN photos added in sequence A, B, C
- WHEN the order's photos are listed or printed
- THEN they MUST appear A, B, C

#### Scenario: Add gated by status
- GIVEN an assigned `tecnico` and orders in each status
- WHEN the técnico uploads a photo
- THEN it MUST succeed for `booked`, `open`, `diagnosing` and `in_progress` and be refused for `on_hold`, `ready_for_review`, `done` and `cancelled`

#### Scenario: Unassigned técnico cannot add or read photos
- GIVEN an `in_progress` order not assigned to técnico T
- WHEN T uploads a photo or requests a photo's bytes
- THEN the system MUST answer 404 and store or return nothing

#### Scenario: Jefe adds during review or hold
- GIVEN a `ready_for_review` or `on_hold` order
- WHEN a `jefe_taller` uploads a valid JPEG
- THEN the system MUST store it

#### Scenario: Delete is administrador-only
- GIVEN an `in_progress` order with a photo
- WHEN a `tecnico` or `jefe_taller` deletes it THEN the system MUST respond 403 and keep it; WHEN an `administrador` deletes it THEN the photo and its stored object MUST be removed

#### Scenario: Delete refused on closed order without correction
- GIVEN a `done` or `cancelled` order with a photo
- WHEN an `administrador` deletes it with no password, or a wrong one
- THEN the system MUST refuse it and keep the photo

#### Scenario: Delete allowed on closed order under correction
- GIVEN a `done` or `cancelled` order with a photo
- WHEN an `administrador` deletes it with their correct password
- THEN the photo and its stored object MUST be removed and the deletion MUST be audited

#### Scenario: Serving is authenticated
- GIVEN a photo URL
- WHEN requested with no session, or a session lacking `service-orders.read`
- THEN the system MUST NOT return the bytes; with such a session it MUST return the JPEG

#### Scenario: Retention spares photos
- GIVEN a retention run
- WHEN it executes
- THEN no object under `service-orders/` MUST be deleted

### Requirement: Order Editing Is Gated by Role and Current Status

The system MUST expose an entry point that opens an existing `orden_servicio` in the order form's edit mode, and MUST allow that edit only when the acting user's role and the order's **current** status jointly permit it, and, for a `tecnico`, only when the order is assigned to them.

Today there is no entry point at all: `ServiceOrderFormTrigger` accepts an optional `order` prop that switches `ServiceOrderForm` into edit mode, and the only place it is rendered — the `/service-orders` list-page header — omits that prop, so the trigger is permanently in create mode. The order detail page offers `OrderStatusControls` and links, and no edit control. `updateOrder` and `PATCH /api/service-orders/[id]` exist and are tested; nothing in the UI reaches them, which is why `hallazgos`, `recomendaciones` and `observaciones` are unreachable after creation. This is a missing surface, not a permission denial.

The permitted combinations are exactly:

| Status | `administrador` | `jefe_taller` | `tecnico` (assigned) |
|---|---|---|---|
| `booked` | MUST be allowed | MUST be allowed | MUST be refused |
| `open` | MUST be allowed | MUST be allowed | MUST be refused |
| `diagnosing` | MUST be allowed | MUST be allowed | MUST be allowed |
| `in_progress` | MUST be allowed | MUST be allowed | MUST be allowed |
| `on_hold` | MUST be allowed | MUST be allowed | MUST be refused |
| `ready_for_review` | MUST be allowed | MUST be allowed | MUST be refused |
| `done` | MUST be refused, except as an audited correction with password re-entry | MUST be refused | MUST be refused |
| `cancelled` | MUST be refused, except as an audited correction with password re-entry | MUST be refused | MUST be refused |

A `tecnico` not assigned to the order MUST be refused in every status (answered as the order not existing, 404).

The gate covers the fields the form and the patch path already carry — `categoria`, `description`, `appointmentAt`, `hallazgos`, `recomendaciones`, `observaciones` — and, while the order is `booked`, `vehiculoId` (see Vehicle and Category Set While Booked). It does not introduce parts anywhere: `producto` line items are absent from creation and from editing alike (see Service Order Creation (R20)).

`done` and `cancelled` are terminal: `assertTransition` gives them no outgoing edges, so a closed order cannot be reopened through the UI, and a correction never changes `status` or `completedAt`. Closed orders refuse `tecnico` and `jefe_taller` always and `administrador` by default; the only way through is the administrator correction defined by `service-order-corrections` (the administrator's own password re-typed in the saving request, every changed field audited). That keeps closure from being reversible through a side door: the status keeps reading `Completada` or `Cancelada`, and every rewrite is attributable.

The presence of the control and the acceptance of the write MUST be decided by one shared pure predicate over role, status and assignment, so the two cannot drift apart; for a closed status the predicate MUST report "correction required" for `administrador` (control shown as "Corregir") and "refused" for every other role. The UI deciding alone is not sufficient: `PATCH /api/service-orders/[id]` is the trust boundary, and the decision MUST be enforced in the service under a row lock (see `service-order-corrections`), evaluated against the order's status **as read from the database**, never a status supplied in the request body. A refusal MUST answer with a Spanish message and an accurate status code, never a 500.
(Previously: rows for `open`, `in_progress`, `ready_for_review`, `done`, `cancelled` only.)

#### Scenario: Administrador and jefe see the edit control on a booked or open order
- GIVEN an order in `booked` or `open` status
- WHEN an `administrador` or a `jefe_taller` opens its detail page
- THEN the page MUST offer a control that opens the order form in edit mode

#### Scenario: Tecnico sees no edit control on a booked or open order
- GIVEN an order in `booked` or `open` status assigned to a `tecnico`
- WHEN that `tecnico` opens its detail page
- THEN the page MUST NOT offer any control that opens the order form in edit mode

#### Scenario: Assigned técnico and admin and jefe see the edit control on a diagnosing or in_progress order
- GIVEN an order in `diagnosing` or `in_progress` status assigned to a `tecnico`
- WHEN that `tecnico`, an `administrador` or a `jefe_taller` opens its detail page
- THEN the page MUST offer the edit control to all three

#### Scenario: Técnico sees no edit control on hold or in review
- GIVEN an order in `on_hold` or `ready_for_review` status assigned to a `tecnico`
- WHEN that `tecnico` opens its detail page
- THEN the page MUST NOT offer the edit control, while an `administrador` or `jefe_taller` MUST see it

#### Scenario: Only the administrador is offered a way in on a closed order
- GIVEN an order in `done` or in `cancelled` status
- WHEN an `administrador` opens its detail page THEN the page MUST offer "Corregir" and no plain edit control; WHEN a `tecnico` or `jefe_taller` opens it THEN the page MUST NOT offer any edit or correction control

#### Scenario: Unassigned técnico cannot patch
- GIVEN an `in_progress` order not assigned to técnico T
- WHEN T sends `PATCH /api/service-orders/[id]` with `hallazgos`
- THEN the system MUST answer 404 and MUST NOT write the field

#### Scenario: The route refuses a patch the UI would not have offered
- GIVEN an order in `open` or `on_hold` status assigned to a `tecnico`
- WHEN that `tecnico` sends `PATCH /api/service-orders/[id]` with `hallazgos`
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: The route refuses a closed-order patch without a verified correction
- GIVEN an order in `done` status
- WHEN an `administrador` sends `PATCH /api/service-orders/[id]` with any of the gated fields and no password, or a wrong one
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: A tecnico's or jefe's patch to a closed order is refused
- GIVEN an order in `done` status
- WHEN a `tecnico` or `jefe_taller` sends `PATCH /api/service-orders/[id]` with any gated field, with or without a password
- THEN the system MUST refuse the patch with 403 (404 for an unassigned técnico) and MUST NOT write the field

#### Scenario: A verified administrator correction of a closed order saves
- GIVEN an order in `done` status
- WHEN an `administrador` sends `PATCH /api/service-orders/[id]` with a gated field and their correct password
- THEN the system MUST persist the field, MUST leave `status` and `completedAt` unchanged, and MUST audit the change

#### Scenario: The route reads status from the record, not from the body
- GIVEN an order whose stored status is `done`
- WHEN a patch arrives whose body also claims a status of `in_progress`
- THEN the gate MUST be evaluated against the stored `done`: without a verified administrator correction the patch MUST be refused, and with one the stored status MUST remain `done`

#### Scenario: A permitted patch still saves
- GIVEN an order in `in_progress` or `diagnosing` status assigned to a `tecnico`
- WHEN that `tecnico` patches `hallazgos` and `recomendaciones`
- THEN the system MUST persist both values

#### Scenario: The edit control meets the hit-target floor
- GIVEN a detail page that offers the edit control
- WHEN it renders
- THEN that control MUST measure at least 44x44 **[LAN]**

### Requirement: Bulk Status Change Constrained to Legal Transitions

Staff MUST be able to select service orders in the list view (per
`table-bulk-actions`) and change their status in bulk. The status-change
menu MUST offer only the target statuses that are legal, via
`getAllowedTransitions`, for EVERY row in the current selection — the
intersection of each selected row's legal next states, not the union, and
not every status unconditionally. Only targets that can be reached by hand
are candidates: the automatic targets `diagnosing` and `ready_for_review` and
the initial-only `booked` MUST NOT be offered, and `on_hold` MUST NOT be
offered in bulk because it needs a reason chosen per order (it is set from the
single-order controls). The bulk action MUST apply `assertTransition` per row
against that row's CURRENT status, looping the existing single-order
transition call sequentially; it MUST NOT read every row's status once and
apply a single batched update. Each applied row writes its own history row.

Because a bulk transition to `done` or `cancelled` is terminal and cannot be
undone through the UI, the confirmation step MUST say so before the action
runs.
(Previously: candidates were the statuses reachable from the five old states; no exclusion of automatic or reason-bearing targets.)

#### Scenarios

- GIVEN a selection of 4 orders, 3 `open` and 1 `in_progress`
- WHEN staff opens the bulk status menu
- THEN it MUST offer only `cancelled` — the one status legal from every selected row's current status — and MUST NOT offer `in_progress` or `done`

- GIVEN a selection of 3 `diagnosing` orders
- WHEN staff opens the bulk status menu
- THEN it MUST offer `in_progress` and `cancelled` and nothing else

- GIVEN a selection of 2 `in_progress` orders
- WHEN staff opens the bulk status menu
- THEN it MUST offer `done` and `cancelled` and MUST NOT offer `on_hold`, `ready_for_review` or `diagnosing`

- GIVEN a selection of 3 `open` orders, one of which another session transitions to `done` before the bulk action runs
- WHEN staff applies "Cancelar" to the original selection
- THEN the system MUST cancel the 2 orders still `open` and report the third by id with the reason its current status no longer allows that transition

- GIVEN a bulk transition targeting `done` or `cancelled`
- WHEN staff confirms the action
- THEN the confirmation copy MUST state that the change cannot be undone through the UI

- GIVEN a bulk cancel of 3 orders **[e2e]**
- WHEN it completes
- THEN exactly 3 history rows `→ cancelled` MUST exist

### Requirement: Order Assignment

An order MUST be assigned to one or more technicians through `orden_tecnico` rows (order, `tecnico`, nullable `parte_lista_at`), unique per order and technician, with foreign keys `ON DELETE RESTRICT`. Only an `administrador` or `jefe_taller` MUST assign, at creation or afterwards, on orders in `booked`, `open`, `diagnosing`, `in_progress`, `on_hold` or `ready_for_review`; assigning on a `done` or `cancelled` order MUST be refused for every role and is not correctable. Assigning requires an active technician; assigning one already assigned MUST be a no-op, not an error. No code path MUST remove an assignment (un-assigning is out of scope). Assignment MUST run through `lockOrderForMutation`. The status effects of assigning are exactly: the first technician assigned to a Recibida (`open`) order MUST move it to `diagnosing` in the same transaction; assigning a new technician to a `ready_for_review` order MUST return it to `in_progress` in the same transaction; assigning to an order in any other status (`booked`, `diagnosing`, `in_progress`, `on_hold`), or a further technician on any order, MUST NOT change its status. No change to a technician roster or assignment set MUST ever move an order out of `diagnosing`: an order whose only technician is deactivated stays `diagnosing`. Existing orders carry no assignment until an administrador or jefe assigns them. The order detail MUST show the assignees and, for administrador and jefe, an assignment control that meets 44x44, shows a Spanish success toast and lists only active technicians.
(Previously: allowed on `open`, `in_progress`, `ready_for_review`; assigning on `open` never changed status.)

#### Scenario: First technician on a Recibida order starts diagnosing **[e2e]**
- GIVEN an `open` order with no assignments
- WHEN an `administrador` or `jefe_taller` assigns technician T
- THEN one `orden_tecnico` row MUST exist with a null `parte_lista_at`, the status MUST be `diagnosing` and one `open → diagnosing` history row MUST exist

#### Scenario: Second technician does not change status **[e2e]**
- GIVEN a `diagnosing` order assigned to T
- WHEN an administrador assigns U
- THEN the status MUST stay `diagnosing` and no history row MUST be written

#### Scenario: Assigning to a booked order keeps it booked **[e2e]**
- GIVEN a `booked` order
- WHEN a jefe assigns technician T
- THEN the assignment MUST persist, the status MUST stay `booked`, and no history row MUST be written

#### Scenario: Assigning on hold or in progress does not change status **[e2e]**
- GIVEN an `in_progress` order and an `on_hold` order
- WHEN an administrador assigns a technician to each
- THEN both statuses MUST be unchanged

#### Scenario: Assigning during review reopens the order **[e2e]**
- GIVEN a `ready_for_review` order where all assigned have marked
- WHEN an administrador assigns another technician U
- THEN the order MUST return to `in_progress` and U's `parte_lista_at` MUST be null

#### Scenario: Deactivating the only technician leaves diagnosing **[e2e]**
- GIVEN a `diagnosing` order whose only technician is then deactivated
- WHEN the order is read
- THEN its status MUST still be `diagnosing`

#### Scenario: Assigning on a closed order is refused
- GIVEN a `done` order
- WHEN an administrador assigns a technician, with or without a password
- THEN the system MUST refuse it and MUST NOT write an assignment

#### Scenario: Técnico cannot assign
- GIVEN a `tecnico` session
- WHEN it sends an assignment request
- THEN the system MUST refuse with 403

#### Scenario: Duplicate assignment is a no-op
- GIVEN an order already assigned to T
- WHEN an administrador assigns T again
- THEN no second row MUST be created and no error MUST be returned

#### Scenario: Deactivated technician refused
- GIVEN a deactivated technician
- WHEN an administrador assigns them
- THEN the system MUST refuse with a Spanish message

#### Scenario: Assignments are never deleted
- GIVEN an assignment row
- WHEN any route is searched for a way to remove it
- THEN none MUST exist, and a direct delete of a technician with assignments MUST be rejected by the database

## ADDED Requirements

### Requirement: Booked Order Without Vehicle or Category

`orden_servicio.vehiculo_id` and `categoria` MUST be nullable ONLY for an order that is `booked`, or `cancelled` (a booked order cancelled as a no-show keeps its nulls). Any other status MUST require both, enforced by the database independently of the service. Every surface that reads an order MUST tolerate the nulls: the list and its count MUST still include such orders (same total, same pagination), the detail page MUST render "Sin vehículo" and "Sin categoría" in place of the vehicle link and category, the print view and the customer copy MUST render without error with those same placeholders, and the search MUST still match such an order by customer name or phone. Appointment-reminder scheduling for a booked order with no category MUST succeed.

#### Scenario: Database rejects a null vehicle outside booked/cancelled **[e2e]**
- GIVEN an order insert or update with null `vehiculo_id` or null `categoria` and a status other than `booked` or `cancelled`
- WHEN it executes
- THEN the database MUST reject it

#### Scenario: Database accepts the nulls while booked **[e2e]**
- GIVEN a `booked` order with null vehicle and category
- WHEN it is inserted
- THEN the database MUST accept it

#### Scenario: Leaving booked without them is refused by the database **[e2e]**
- GIVEN a `booked` order with a null vehicle
- WHEN a direct update sets its status to `open`
- THEN the database MUST reject it

#### Scenario: List and count agree **[e2e]**
- GIVEN 3 orders of which 1 is `booked` with no vehicle
- WHEN the list renders unfiltered, and again filtered by status "Agendada"
- THEN the unfiltered list MUST show 3 rows and count 3, and the filtered one MUST show 1 row and count 1

#### Scenario: Search still finds a vehicle-less order **[e2e]**
- GIVEN a `booked` order with no vehicle for customer "Pérez"
- WHEN staff searches "perez"
- THEN that order MUST appear, and searching a plate MUST NOT error

#### Scenario: Detail and print render placeholders
- GIVEN a `booked` order with null vehicle and category
- WHEN staff opens its detail page and its print view
- THEN each MUST show "Sin vehículo" and "Sin categoría", offer no vehicle link, and not error; the workshop copy MUST still print exactly one page

#### Scenario: Reminder scheduling tolerates a null category **[unit]**
- GIVEN a booked order with `appointmentAt` and no `categoria`
- WHEN the appointment reminder is scheduled
- THEN scheduling MUST succeed

### Requirement: Vehicle and Category Set While Booked

While an order is `booked`, an `administrador` or `jefe_taller` MUST be able to set or change its `vehiculoId` and `categoria` through the order edit path. A supplied vehicle MUST belong to the order's `cliente` and MUST be active. Once the order is no longer `booked`, `vehiculoId` MUST NOT be patchable (unchanged behavior) while `categoria` stays patchable per Category and Completion Notes Editing.

#### Scenario: Complete a booked order **[e2e]**
- GIVEN a `booked` order with null vehicle and category
- WHEN an administrador patches a vehicle of that customer and a `categoria`
- THEN both MUST persist and the status MUST stay `booked`

#### Scenario: Foreign or inactive vehicle refused
- GIVEN a `booked` order of customer A
- WHEN a patch names customer B's vehicle, or a deactivated vehicle of A
- THEN the system MUST reject it with a Spanish message and change nothing

#### Scenario: Vehicle frozen after booked **[e2e]**
- GIVEN an `open` order
- WHEN a patch includes `vehiculoId`
- THEN the system MUST ignore or refuse it and the stored vehicle MUST be unchanged

#### Scenario: Técnico cannot set the vehicle
- GIVEN a `tecnico` assigned to a `booked` order
- WHEN it patches `vehiculoId`
- THEN the system MUST refuse it (the edit gate refuses `booked` for a técnico)

### Requirement: On-Hold Reason

Putting an order on hold MUST require exactly one reason: `repuesto` ("Repuesto") or `aprobacion_cliente` ("Aprobación del cliente"). The order MUST store the reason while it is `on_hold` and MUST hold no reason in every other status, enforced by the database independently of the service. The transition route MUST refuse `on_hold` without a valid reason, and MUST refuse a reason supplied with any other target, with a Spanish message. Leaving `on_hold` clears the reason. The detail page MUST show the reason while the order is on hold, and the single-order status controls MUST ask for the reason before putting an order on hold.

#### Scenario: Reason required
- GIVEN an `in_progress` order
- WHEN a jefe puts it on hold with no reason, or with `otro`
- THEN the system MUST refuse with a Spanish message and the status MUST stay `in_progress`

#### Scenario: Reason stored and cleared **[e2e]**
- GIVEN an `in_progress` order put on hold with `aprobacion_cliente`
- WHEN it is read, then resumed and read again
- THEN the first read MUST show the reason and the second MUST show none

#### Scenario: Reason on another target refused
- GIVEN an `in_progress` order
- WHEN a transition to `done` carries a reason
- THEN the system MUST refuse it and change nothing

#### Scenario: Database ties reason to on_hold **[e2e]**
- GIVEN a direct write of an `on_hold` row with no reason, or an `in_progress` row with a reason
- WHEN it executes
- THEN the database MUST reject it

### Requirement: Appointment Reminder Fires Only While Booked

The `appointment` reminder MUST be sent only if, at the moment it fires, the order is still `booked`, judged from the current database state. For any other status the reminder MUST NOT be sent and MUST NOT fail the job; the existing skip behavior of reminders applies. Other reminder types are unaffected.

#### Scenario: Still booked sends **[e2e]**
- GIVEN a scheduled `appointment` reminder for a `booked` order
- WHEN it fires
- THEN it MUST be sent

#### Scenario: Received early is skipped **[e2e]**
- GIVEN a scheduled `appointment` reminder for an order that was received (`open`, `diagnosing` or later)
- WHEN it fires
- THEN nothing MUST be sent and the job MUST complete without error

#### Scenario: Cancelled is skipped **[e2e]**
- GIVEN a scheduled `appointment` reminder for a `cancelled` order
- WHEN it fires
- THEN nothing MUST be sent

#### Scenario: Retry stays idempotent **[unit]**
- GIVEN a reminder already sent for a `booked` order
- WHEN the job is retried
- THEN it MUST NOT send twice

### Requirement: Status Labels, Badge and List Filter

Every status MUST render with its Spanish label (list above) through `StatusBadge` on the list, the cards, and the detail page, each visually distinguishable; `open` MUST read "Recibida", never "Abierta". The `/service-orders` status filter MUST offer all eight statuses, `cancelled` included. A `status` URL parameter outside the eight MUST be ignored. Sorting by status MUST order `booked`, `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`, `done`, `cancelled` ascending. The detail page for an `on_hold` order MUST show the badge with its reason.

#### Scenario: Each label renders **[unit]**
- GIVEN one order in each of the eight statuses
- WHEN the list renders
- THEN the badges MUST read "Agendada", "Recibida", "En diagnóstico", "En progreso", "En espera", "Lista para revisión", "Completada", "Cancelada" and none MUST read "Abierta"

#### Scenario: Filter by each new status **[e2e]**
- GIVEN one order in each status
- WHEN staff filters by `diagnosing`, `on_hold`, `booked` and `cancelled` in turn
- THEN each filter MUST return exactly that order and count 1

#### Scenario: Unknown status parameter ignored
- GIVEN `?status=garbage`
- WHEN the list renders
- THEN it MUST behave as unfiltered and not error

#### Scenario: Sort order **[e2e]**
- GIVEN one order in each status, sorted by status ascending
- WHEN the list renders
- THEN the order MUST be the lifecycle sequence stated above

### Requirement: Status Actions Confirm With a Toast

Each successful status action on the order detail MUST show a Spanish success toast above `router.refresh()` and below the `try/catch` (per AGENTS.md), subject first, verb in the past, no exclamation marks. New copy: putting on hold "Orden puesta en espera"; resuming "Orden reanudada"; receiving a booked order "Orden recibida"; diagnosing → in progress "Orden pasada a En progreso"; setting vehicle and category on a booked order "Vehículo y categoría guardados". Failures MUST stay inline, with no toast. Bulk results keep reporting rows that actually applied, singular when one ("1 orden cancelada").

#### Scenario: Hold toast
- GIVEN an `in_progress` order and a jefe who picks a reason
- WHEN the hold succeeds
- THEN the toast "Orden puesta en espera" MUST show and the page MUST refresh

#### Scenario: Resume and receive toasts
- GIVEN an `on_hold` order and a `booked` order
- WHEN each action succeeds
- THEN "Orden reanudada" and "Orden recibida" MUST show respectively

#### Scenario: Refused action shows no toast
- GIVEN a hold attempt the server refuses
- WHEN the response arrives
- THEN no success toast MUST show and the Spanish error MUST appear inline

#### Scenario: Refresh failure does not retract the toast
- GIVEN a hold the server accepted but whose `router.refresh()` throws
- WHEN it settles
- THEN the success toast MUST already have shown
