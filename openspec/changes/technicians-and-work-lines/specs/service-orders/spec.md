# Delta Spec: service-orders

Orders gain people: creation is restricted to administrador and jefe and names technicians; a técnico sees and edits only assigned orders; the lifecycle gains `ready_for_review`; `jefe_taller` joins the editing gate. This delta is written against the post-`closed-order-lock` text of "Reception Photos" and "Order Editing Is Gated by Role and Current Status", so `closed-order-lock` MUST be archived first. Closed-order correction rules are unchanged (`service-order-corrections`).

## MODIFIED Requirements

### Requirement: Service Order Creation (R20)

The system MUST allow an `administrador` or a `jefe_taller` to create an `orden_servicio` that references exactly one existing `cliente`, exactly one existing `vehiculo` belonging to that same `cliente`, a `categoria`, ZERO or more assigned technicians (active roster rows; reception happens before assignment, so none is required), and an optional `observaciones` string. A `tecnico` MUST NOT create orders: the create route MUST refuse them with 403 and the create control MUST NOT render for them. Creation MUST NOT accept `producto` line items. `orden_servicio.vehiculoId` MUST be NOT NULL and MUST be a foreign key to `vehiculo` with `ON DELETE RESTRICT`. A new order MUST be created in `open` status, with any supplied assignments written in the same transaction. An order with no assignment is visible to administrador and jefe only until one of them assigns it later. A deactivated or unknown technician MUST be refused. `hallazgos` and `recomendaciones` MUST NOT be settable at creation — see the Category and Completion Notes Editing requirement. `ordenServicioItem` has no writer once this requirement ships: no code path inserts a line item for any order, so every order's "Piezas utilizadas" detail card renders its empty state permanently. The table and the card both remain in place, for existing rows and a future recording-parts-used flow.

#### Scenario: Order created with no parts, an optional categoria and observaciones
- GIVEN an existing `cliente` with an active `vehiculo` and an active technician
- WHEN an administrador or jefe creates a service order naming that vehicle, a `categoria` and that technician
- THEN the system MUST create the order in `open` status, referencing that vehicle and category, with no line items and one assignment

#### Scenario: Order may be created with no technician
- GIVEN a create payload with no technician
- WHEN an administrador or jefe submits it
- THEN the system MUST create the order in `open` status with zero assignments, and a later assignment MUST be possible

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

#### Scenario: Customer with zero active vehicles blocks submission
- GIVEN a `cliente` with zero active vehicles
- WHEN staff opens the order-creation form for that customer
- THEN the vehicle picker MUST offer no selectable vehicle and submission MUST be prevented

#### Scenario: Observaciones persists from creation
- GIVEN a create payload with `observaciones = "trae ruido al frenar"`
- WHEN the order is created
- THEN the system MUST persist that value on the new order

#### Scenario: A new order's Piezas card always shows its empty state
- GIVEN an order created after this requirement ships
- WHEN staff opens its detail view
- THEN the "Piezas utilizadas" card MUST render its empty state

### Requirement: Status Lifecycle Transitions (R21)

An `orden_servicio` MUST have a status of `open`, `in_progress`, `ready_for_review` (shown "Lista para revisión"), `done`, or `cancelled`. The ONLY valid transitions are: `open → in_progress`, `in_progress → ready_for_review`, `ready_for_review → in_progress`, `in_progress → done`, `ready_for_review → done`, `open → cancelled`, `in_progress → cancelled` and `ready_for_review → cancelled`. `done` and `cancelled` MUST be terminal states — no transition out of either is valid. Direct `open → done` and `open → ready_for_review` MUST be rejected. `in_progress → ready_for_review` happens ONLY as the consequence of the last "Mi parte lista" mark (see `order-work-lines`); the manual transition route MUST reject `ready_for_review` as a target. `ready_for_review → in_progress` happens when a técnico un-marks, when a technician is assigned to the order (see Order Assignment), or by an administrador or jefe through the transition route. Who may transition: an assigned `tecnico` may perform `open → in_progress` only; `done` and `cancelled` targets MUST be performed only by an `administrador` or `jefe_taller`, from `in_progress` or `ready_for_review`, regardless of marks. Every transition MUST record the timestamp at which it occurred.

#### Scenarios

- GIVEN an order in `open` WHEN staff transitions it to `in_progress` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `in_progress` WHEN an administrador or jefe transitions it to `done` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `ready_for_review` WHEN an administrador or jefe transitions it to `done` THEN the system MUST accept it
- GIVEN an order in `in_progress` or `ready_for_review` with unmarked technicians WHEN an administrador or jefe closes it THEN the system MUST accept it
- GIVEN an order in `in_progress` WHEN anyone calls the transition route with target `ready_for_review` THEN the system MUST reject it as an invalid transition
- GIVEN an order in `open` WHEN staff attempts to transition it directly to `done` or `ready_for_review` THEN the system MUST reject the transition
- GIVEN an order in `ready_for_review` WHEN an administrador or jefe transitions it to `in_progress` THEN the system MUST accept it
- GIVEN an assigned `tecnico` WHEN they transition an order to `done` or `cancelled` THEN the system MUST refuse with 403 and change nothing
- GIVEN an assigned `tecnico` and an `open` order WHEN they transition it to `in_progress` THEN the system MUST accept it
- GIVEN an order in `open` WHEN an administrador or jefe cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `in_progress` or `ready_for_review` WHEN an administrador or jefe cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `done` WHEN staff attempts any further transition THEN the system MUST reject it because `done` is terminal
- GIVEN an order in `cancelled` WHEN staff attempts any further transition THEN the system MUST reject it because `cancelled` is terminal
- GIVEN the `/service-orders` list WHEN it renders THEN it MUST show a "Lista para revisión" badge for `ready_for_review` orders and offer that status in the status filter

### Requirement: Async Customer Selection in Order Creation (R23)

When creating or editing an `orden_servicio`, the customer picker MUST query customer search asynchronously (debounced, as staff types) instead of preloading the full customer list. A customer already selected on an order being edited MUST be resolved and rendered by id, even when it matches no current search term. WHEN a search yields zero exact matches, the picker MUST render near matches as the primary content, above any inline "create customer" affordance. The create affordance MUST appear only as a secondary action after the near matches, and MUST require `customers.write`; a user with only `customers.read` MUST see near matches with no create option. Every route (list, create, detail, status transition) MUST call `can()` for `service-orders.read`/`service-orders.write` after `requireSession()`, enforcing default-deny policy.

#### Scenarios

- GIVEN the service-order creation page loads WHEN it renders THEN the system MUST NOT preload any customer rows; a query MUST fire only once staff types a search term
- GIVEN the picker is handed an already-resolved customer by its parent AND the current search term matches no rows, or matches rows that exclude that customer WHEN the picker renders THEN it MUST render that customer as its selected option, without issuing a query to find it
- GIVEN a search with zero exact matches but at least one near match WHEN the picker renders its empty state for a user with `customers.write` THEN the near matches MUST render first, and "create customer" MUST render only after them, never beside or above them
- GIVEN the same zero-exact-match search, but a user with only `customers.read` WHEN the picker renders its empty state THEN the system MUST show the near matches with no "create customer" action
- GIVEN a search term with no exact and no near matches WHEN the picker renders its empty state THEN the system MUST show an explicit no-matches message, followed by the create-customer affordance when `customers.write` is held
- AND a user without `customers.write` MUST still see that message, because rendering nothing is indistinguishable from a search that has not finished
- GIVEN a `tecnico` with a valid session WHEN they call a service-order read, patch or transition route for an order assigned to them THEN `can()` MUST evaluate `true` and the request MUST succeed as it does today, subject to the status and role gates; the create route is the exception (see Service Order Creation (R20))
- GIVEN an `administrador` or `jefe_taller` with a valid session WHEN they call any service-order route THEN `can()` MUST evaluate `true` and the request MUST succeed

### Requirement: Reception Photos

An order MUST hold up to 12 reception photos, stored as JPEG in object storage under `service-orders/<ordenId>/<photoId>.jpg` with a server-generated id, listed by `position` ascending. The server MUST accept a file only if its leading bytes are a JPEG signature (the declared content type MUST NOT be trusted) and its size is at most 3 MB. Photo bytes MUST be served only through an authenticated same-origin route to sessions holding `service-orders.read`; a `tecnico` MUST be served photos only of orders assigned to them (any other order answers 404). Adding MUST be allowed while the order is `open` or `in_progress` to any role holding `service-orders.write` (a `tecnico` only on an order assigned to them), while `ready_for_review` only to an `administrador` or `jefe_taller`, and refused when `done` or `cancelled` unless it is an authorized administrator correction (see `service-order-corrections`). Deleting MUST be allowed only to `administrador` while `open`, `in_progress` or `ready_for_review`, or while `done` or `cancelled` under an authorized administrator correction; any other role (including `jefe_taller`) MUST receive 403, and a closed-order delete without an authorized correction MUST be refused. Photos MUST never be removed by retention. The order detail MUST show a "Fotos de recepción" card.

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
- THEN it MUST succeed for `open` and `in_progress` and be refused for `ready_for_review`, `done` and `cancelled`

#### Scenario: Unassigned técnico cannot add or read photos
- GIVEN an `in_progress` order not assigned to técnico T
- WHEN T uploads a photo or requests a photo's bytes
- THEN the system MUST answer 404 and store or return nothing

#### Scenario: Jefe adds during review
- GIVEN a `ready_for_review` order
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
| `open` | MUST be allowed | MUST be allowed | MUST be refused |
| `in_progress` | MUST be allowed | MUST be allowed | MUST be allowed |
| `ready_for_review` | MUST be allowed | MUST be allowed | MUST be refused |
| `done` | MUST be refused, except as an audited correction with password re-entry | MUST be refused | MUST be refused |
| `cancelled` | MUST be refused, except as an audited correction with password re-entry | MUST be refused | MUST be refused |

A `tecnico` not assigned to the order MUST be refused in every status (answered as the order not existing, 404).

The gate covers the fields the form and the patch path already carry — `categoria`, `description`, `appointmentAt`, `hallazgos`, `recomendaciones`, `observaciones`. It does not introduce parts anywhere: `producto` line items are absent from creation and from editing alike (see Service Order Creation (R20)).

`done` and `cancelled` are terminal: `assertTransition` gives them no outgoing edges, so a closed order cannot be reopened through the UI, and a correction never changes `status` or `completedAt`. Closed orders refuse `tecnico` and `jefe_taller` always and `administrador` by default; the only way through is the administrator correction defined by `service-order-corrections` (the administrator's own password re-typed in the saving request, every changed field audited). That keeps closure from being reversible through a side door: the status keeps reading `Completada` or `Cancelada`, and every rewrite is attributable.

The presence of the control and the acceptance of the write MUST be decided by one shared pure predicate over role, status and assignment, so the two cannot drift apart; for a closed status the predicate MUST report "correction required" for `administrador` (control shown as "Corregir") and "refused" for every other role. The UI deciding alone is not sufficient: `PATCH /api/service-orders/[id]` is the trust boundary, and the decision MUST be enforced in the service under a row lock (see `service-order-corrections`), evaluated against the order's status **as read from the database**, never a status supplied in the request body. A refusal MUST answer with a Spanish message and an accurate status code, never a 500.

#### Scenario: Administrador and jefe see the edit control on an open order
- GIVEN an order in `open` status
- WHEN an `administrador` or a `jefe_taller` opens its detail page
- THEN the page MUST offer a control that opens the order form in edit mode

#### Scenario: Tecnico sees no edit control on an open order
- GIVEN an order in `open` status assigned to a `tecnico`
- WHEN that `tecnico` opens its detail page
- THEN the page MUST NOT offer any control that opens the order form in edit mode

#### Scenario: Assigned técnico and admin and jefe see the edit control on an in_progress order
- GIVEN an order in `in_progress` status assigned to a `tecnico`
- WHEN that `tecnico`, an `administrador` or a `jefe_taller` opens its detail page
- THEN the page MUST offer the edit control to all three

#### Scenario: Técnico sees no edit control in review
- GIVEN an order in `ready_for_review` status assigned to a `tecnico`
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
- GIVEN an order in `open` status assigned to a `tecnico`
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
- GIVEN an order in `in_progress` status assigned to a `tecnico`
- WHEN that `tecnico` patches `hallazgos` and `recomendaciones`
- THEN the system MUST persist both values

#### Scenario: The edit control meets the hit-target floor
- GIVEN a detail page that offers the edit control
- WHEN it renders
- THEN that control MUST measure at least 44x44

## ADDED Requirements

### Requirement: Order Assignment

An order MUST be assigned to one or more technicians through `orden_tecnico` rows (order, `tecnico`, nullable `parte_lista_at`), unique per order and technician, with foreign keys `ON DELETE RESTRICT`. Only an `administrador` or `jefe_taller` MUST assign, at creation or afterwards, on orders in `open`, `in_progress` or `ready_for_review`; assigning on a `done` or `cancelled` order MUST be refused for every role and is not correctable. Assigning requires an active technician; assigning one already assigned MUST be a no-op, not an error. No code path MUST remove an assignment (un-assigning is out of scope). Assignment MUST run through `lockOrderForMutation`. Assigning a new technician to a `ready_for_review` order MUST return it to `in_progress` in the same transaction; assigning to an `open` or `in_progress` order MUST NOT change its status. Existing orders carry no assignment until an administrador or jefe assigns them. The order detail MUST show the assignees and, for administrador and jefe, an assignment control that meets 44x44, shows a Spanish success toast and lists only active technicians.

#### Scenario: Admin or jefe assigns an open order
- GIVEN an `open` order with no assignments
- WHEN an `administrador` or `jefe_taller` assigns technician T
- THEN one `orden_tecnico` row MUST exist with a null `parte_lista_at` and the status MUST stay `open`

#### Scenario: Assigning during review reopens the order
- GIVEN a `ready_for_review` order where all assigned have marked
- WHEN an administrador assigns another technician U
- THEN the order MUST return to `in_progress` and U's `parte_lista_at` MUST be null

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

### Requirement: Técnico Sees and Acts Only on Assigned Orders

For a `tecnico`, EVERY order read and write path MUST be scoped by one shared predicate "is this technician assigned to this order", resolved from the session user's linked roster row, and used by the queries and by the mutation guard rather than per route. The paths are: the orders list (including search, sort, pagination and counts), the detail page, the print view, photo bytes and photo add, status transitions, PATCH, work lines and marks. An order the técnico is not assigned to MUST be absent from lists and counts and MUST answer 404 on every direct route (never 403, so existence is not revealed). A `tecnico` whose login has no linked roster row MUST see an empty list and 404 on every order route. `administrador` and `jefe_taller` MUST see and act on every order. This requirement covers orders only; customer and vehicle access is unchanged.

#### Scenario: List shows only assigned orders
- GIVEN 3 orders where técnico T is assigned to 1
- WHEN T opens `/service-orders`
- THEN exactly that 1 order MUST appear and the pagination count MUST be 1

#### Scenario: Search cannot reach unassigned orders
- GIVEN an unassigned order whose customer is "Pérez"
- WHEN T searches "perez"
- THEN it MUST NOT appear

#### Scenario: Direct routes answer 404
- GIVEN an order not assigned to T
- WHEN T requests its detail, print view, photo bytes, a transition or a patch
- THEN each MUST answer 404 and write nothing

#### Scenario: Técnico without a roster row
- GIVEN a `tecnico` user with no linked roster row
- WHEN they open the orders list or any order route
- THEN the list MUST be empty and every order route MUST answer 404

#### Scenario: Admin and jefe see everything
- GIVEN orders assigned to nobody or to other technicians
- WHEN an `administrador` or `jefe_taller` opens the list
- THEN every order MUST appear

#### Scenario: Scoping is exercised against real SQL
- GIVEN the e2e suite with a real Postgres
- WHEN it runs list, detail, print, photo, transition, patch and line paths as an unassigned técnico
- THEN every path MUST deny, because injected-seam unit tests prove no real `WHERE` coverage
