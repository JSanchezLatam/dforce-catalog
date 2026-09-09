# Delta for service-orders

## MODIFIED Requirements

### Requirement: Service Order Creation (R20)

The system MUST allow staff to create an `orden_servicio` that references exactly one existing `cliente`, exactly one existing `vehiculo` belonging to that same `cliente`, a `categoria`, and an optional `observaciones` string. Creation MUST NOT accept `producto` line items. `orden_servicio.vehiculoId` MUST be NOT NULL and MUST be a foreign key to `vehiculo` with `ON DELETE RESTRICT`. A new order MUST be created in `open` status. `hallazgos` and `recomendaciones` MUST NOT be settable at creation — see the Category and Completion Notes Editing requirement. `ordenServicioItem` has no writer once this requirement ships: no code path inserts a line item for any order, so every order's "Piezas utilizadas" detail card renders its empty state permanently. The table and the card both remain in place, for existing rows and a future recording-parts-used flow.
(Previously: creation accepted zero or more `producto` line items, each with a recorded quantity, and excluded `observaciones` entirely.)

#### Scenario: Order created with no parts, an optional categoria and observaciones
- GIVEN an existing `cliente` with an active `vehiculo`
- WHEN staff creates a service order naming that vehicle and a `categoria`
- THEN the system MUST create the order in `open` status, referencing that vehicle and category, with no line items

#### Scenario: [DELETED] Line item recorded at creation
(Reason: creation no longer accepts `producto` line items — see requirement text above. Migration: None; `ordenServicioItem` has no writer of any kind after this change.)

#### Scenario: [DELETED] Duplicate producto merges or adds a second line item
(Reason: this scenario's precondition — an order already carrying a line item — can never occur, since no path writes one. Migration: None.)

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

### Requirement: Category and Completion Notes Editing

The system MUST allow staff to patch an existing order's `categoria`, `hallazgos`, `recomendaciones`, and `observaciones` fields, in addition to the existing `description`/`appointmentAt` patch fields; `transitionOrder` continues to own `status` exclusively. `categoria` remains patchable after creation because a technician may discover the service actually performed differs from what was booked. `observaciones` records what the customer asked for at booking time; it MAY also be set at creation (see Service Order Creation (R20)) and remains patchable afterward for correction. `hallazgos` and `recomendaciones` record technician findings produced only once the vehicle has been examined, so they MUST NOT appear in the create dialog and MUST be settable only through this patch path.
(Previously: all three note fields — `hallazgos`, `recomendaciones`, and `observaciones` — were excluded from creation and settable only via patch.)

#### Scenario: Patch persists all three note fields
- GIVEN an order created without any note fields
- WHEN staff patches it with `hallazgos`, `recomendaciones`, and `observaciones`
- THEN the system MUST persist all three values on that order

#### Scenario: Categoria patchable after creation
- GIVEN an order created with `categoria = "Mant. Preventivo"`
- WHEN a technician determines the work performed is actually `"Reparación"` and staff patches `categoria`
- THEN the system MUST update it and leave every other field unchanged

#### Scenario: Hallazgos and recomendaciones stay rejected at creation
- GIVEN a create-order request payload that includes `hallazgos` or `recomendaciones`
- WHEN the order is created
- THEN the system MUST ignore or reject those fields and MUST NOT store them on the new order

#### Scenario: Observaciones stored, hallazgos rejected, from the same payload
- GIVEN a create-order request payload that includes both `observaciones` and `hallazgos`
- WHEN the order is created
- THEN the system MUST persist `observaciones` and MUST ignore or reject `hallazgos`

## ADDED Requirements

### Requirement: Customer Selection Clear and Explicit Deselect (Create Mode Only)

The order-creation `CustomerPicker` MUST clear its search term, result list, and any near-match state the moment a customer is selected. The selected-customer banner MUST offer an explicit control to deselect — at minimum `min-h-11 min-w-11` — separate from selecting a different customer. Deselecting MUST clear `ServiceOrderForm`'s `vehiculoId` state, because a stale vehicle id from the previous customer is otherwise caught only server-side, as an ownership error the operator cannot explain. This applies to order CREATION only; the order-EDIT form MUST NOT offer a deselect control, because `clienteId` is not patchable.

#### Scenario: Selecting a customer clears search state
- GIVEN order creation with a customer search in progress
- WHEN staff selects a customer from the results
- THEN the search term, result list, and near-match state MUST all clear

#### Scenario: Deselect clears the chosen vehicle
- GIVEN a selected customer with a vehicle already chosen
- WHEN staff deselects the customer
- THEN `vehiculoId` MUST also clear, leaving no vehicle chosen

#### Scenario: Deselect control meets the hit-target floor
- GIVEN the selected-customer banner
- WHEN it renders
- THEN its deselect control MUST measure at least 44x44

#### Scenario: Edit mode offers no deselect
- GIVEN an order being edited
- WHEN staff opens the form
- THEN it MUST NOT show any customer deselect control

### Requirement: Order Creation Description Field and Appointment Label

`Descripción` MUST be a multi-line text input (`<textarea>`) on the order-creation and edit forms, not a single-line input. The appointment field's label MUST read exactly `Fecha y hora de inicio`; the field itself remains a `datetime-local` input with unchanged value handling.

#### Scenario: Descripción is multi-line
- GIVEN the order form
- WHEN it renders
- THEN `Descripción` MUST render as a multi-line textarea

#### Scenario: Appointment label reads the new text
- GIVEN the order form
- WHEN it renders
- THEN the appointment field's label MUST read exactly "Fecha y hora de inicio"

### Requirement: Printable Work Order

The system MUST provide a print view for an existing `orden_servicio`, reachable via an "Imprimir" action on that order's detail page, gated by `service-orders.read`. The view MUST NOT auto-open on order creation. Printing it (`@media print` + `window.print()`) MUST produce one page carrying: cliente (nombre, teléfono), vehículo (placa, marca, modelo, año), categoría, fecha y hora de inicio, descripción, and observaciones. The page MUST also reserve blank ruled space under a "Trabajo realizado / Hallazgos" heading, with a signature line — layout only, with no backing database column.

#### Scenario: Imprimir navigates to the print view
- GIVEN an order detail page
- WHEN staff clicks "Imprimir"
- THEN the system MUST navigate to that order's print view

#### Scenario: Printed page carries the order's data
- GIVEN the print view for an order with all fields set
- WHEN it is printed
- THEN the page MUST show cliente, vehículo, categoría, fecha y hora de inicio, descripción, and observaciones

#### Scenario: Printed page reserves handwriting space
- GIVEN the print view
- WHEN it is printed
- THEN it MUST show blank ruled space under "Trabajo realizado / Hallazgos" with a signature line, backed by no stored field

#### Scenario: Print view enforces the same read gate
- GIVEN a session without `service-orders.read`
- WHEN it requests an order's print view
- THEN the system MUST refuse it exactly as any other order-read route

### Requirement: Order Editing Is Gated by Role and Current Status

The system MUST expose an entry point that opens an existing `orden_servicio` in the order form's edit mode, and MUST allow that edit only when the acting user's role and the order's **current** status jointly permit it.

Today there is no entry point at all: `ServiceOrderFormTrigger` accepts an optional `order` prop that switches `ServiceOrderForm` into edit mode, and the only place it is rendered — the `/service-orders` list-page header — omits that prop, so the trigger is permanently in create mode. The order detail page offers `OrderStatusControls` and links, and no edit control. `updateOrder` and `PATCH /api/service-orders/[id]` exist and are tested; nothing in the UI reaches them, which is why `hallazgos`, `recomendaciones` and `observaciones` are unreachable after creation. This is a missing surface, not a permission denial.

The permitted combinations are exactly:

| Status | `administrador` | `tecnico` |
|---|---|---|
| `open` | MUST be allowed | MUST be refused |
| `in_progress` | MUST be allowed | MUST be allowed |
| `done` | MUST be refused | MUST be refused |
| `cancelled` | MUST be refused | MUST be refused |

The gate covers the fields the form and the patch path already carry — `categoria`, `description`, `appointmentAt`, `hallazgos`, `recomendaciones`, `observaciones`. It does not introduce parts anywhere: `producto` line items are absent from creation and from editing alike (see Service Order Creation (R20)).

`done` and `cancelled` refusing everyone is a decision of this change rather than a restatement of the owner's request, which named only `open` and `in_progress`. Those two are already terminal — `assertTransition` gives them no outgoing edges, so a closed order cannot be reopened through the UI. Letting an order's fields be rewritten after closure would make closure reversible through a side door, one field at a time, with the status still reading `Completada`. Correcting a wrongly-closed order is a separate change with its own audit story; it is not this gate loosened.

Both the presence of the control and the acceptance of the write MUST be decided by one shared pure predicate over role and status, so the two cannot drift apart. The UI deciding alone is not sufficient: `PATCH /api/service-orders/[id]` is the trust boundary, and it MUST evaluate the same predicate against the order's status **as read from the database**, never a status supplied in the request body. A refusal MUST answer with a Spanish message and an accurate status code, never a 500.

#### Scenario: Administrador sees the edit control on an open order
- GIVEN an order in `open` status
- WHEN an `administrador` opens its detail page
- THEN the page MUST offer a control that opens the order form in edit mode

#### Scenario: Tecnico sees no edit control on an open order
- GIVEN an order in `open` status
- WHEN a `tecnico` opens its detail page
- THEN the page MUST NOT offer any control that opens the order form in edit mode

#### Scenario: Both roles see the edit control on an in_progress order
- GIVEN an order in `in_progress` status
- WHEN either a `tecnico` or an `administrador` opens its detail page
- THEN the page MUST offer the edit control to both

#### Scenario: Neither role sees the edit control on a closed order
- GIVEN an order in `done` or in `cancelled` status
- WHEN either a `tecnico` or an `administrador` opens its detail page
- THEN the page MUST NOT offer any edit control to either

#### Scenario: The route refuses a patch the UI would not have offered
- GIVEN an order in `open` status
- WHEN a `tecnico` sends `PATCH /api/service-orders/[id]` with `hallazgos`
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: The route refuses any patch to a closed order
- GIVEN an order in `done` status
- WHEN an `administrador` sends `PATCH /api/service-orders/[id]` with any of the gated fields
- THEN the system MUST refuse the patch with a Spanish message, MUST NOT write the field, and MUST NOT answer 500

#### Scenario: The route reads status from the record, not from the body
- GIVEN an order whose stored status is `done`
- WHEN a patch arrives whose body also claims a status of `in_progress`
- THEN the gate MUST be evaluated against the stored `done` and the patch MUST be refused

#### Scenario: A permitted patch still saves
- GIVEN an order in `in_progress` status
- WHEN a `tecnico` patches `hallazgos` and `recomendaciones`
- THEN the system MUST persist both values

#### Scenario: The edit control meets the hit-target floor
- GIVEN a detail page that offers the edit control
- WHEN it renders
- THEN that control MUST measure at least 44x44

## Verification Notes

- `@media print` output and `window.print()` are invisible to jsdom. A real print preview IS the verification for the Printable Work Order requirement — not a substitute for one.
- `/service-orders` has 0 rows in the dev database today; exercising any of the scenarios above against a rendered order needs seeded data first.
- The role-and-status gate's eight combinations are a pure function of two enums, so the truth table is fully coverable DB-free — but only the predicate is. Whether the detail page and the route actually consult it is separate coverage, and a green predicate test says nothing about either call site.
