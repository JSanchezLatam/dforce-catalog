# Spec: service-orders

This spec consolidates R20–R22 from `crm-workshop-management` (baseline), adds access-control requirements from `crm-shell-settings-rbac`, incorporates R23 from `customer-search-and-picker` (async customer selection), and layers in the mandatory vehicle/category link and completion notes from `service-history-per-vehicle` (C4).

## REQUIREMENTS

### Requirement: Service Order Creation (R20)

The system MUST allow staff to create an `orden_servicio` that references exactly one existing `cliente`, exactly one existing `vehiculo` belonging to that same `cliente`, a `categoria`, and an optional `observaciones` string. Creation MUST NOT accept `producto` line items. `orden_servicio.vehiculoId` MUST be NOT NULL and MUST be a foreign key to `vehiculo` with `ON DELETE RESTRICT`. A new order MUST be created in `open` status. `hallazgos` and `recomendaciones` MUST NOT be settable at creation — see the Category and Completion Notes Editing requirement. `ordenServicioItem` has no writer once this requirement ships: no code path inserts a line item for any order, so every order's "Piezas utilizadas" detail card renders its empty state permanently. The table and the card both remain in place, for existing rows and a future recording-parts-used flow.

#### Scenario: Order created with no parts, an optional categoria and observaciones
- GIVEN an existing `cliente` with an active `vehiculo`
- WHEN staff creates a service order naming that vehicle and a `categoria`
- THEN the system MUST create the order in `open` status, referencing that vehicle and category, with no line items

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

### Requirement: Service Category Vocabulary

The system MUST classify every order under exactly one of five `categoria` values: Instalación, Mant. Preventivo, Mant. Correctivo, Reparación, and REVISADO. REVISADO — Panama's mandatory annual ATTT technical inspection, a legal prerequisite for renewing the vehicle's plate — MUST be modeled as a peer service type alongside the other four, not as an order status. It is independent of `orderStatusEnum` (`open`/`in_progress`/`done`/`cancelled`).

#### Scenarios

- GIVEN the order-creation form WHEN staff opens the category selector THEN REVISADO MUST appear alongside Instalación, Mant. Preventivo, Mant. Correctivo, and Reparación with no distinct treatment
- GIVEN a create or patch request with `categoria` set to a value outside the five enumerated ones WHEN it is submitted THEN the system MUST reject it with a validation error

### Requirement: Category and Completion Notes Editing

The system MUST allow staff to patch an existing order's `categoria`, `hallazgos`, `recomendaciones`, and `observaciones` fields, in addition to the existing `description`/`appointmentAt` patch fields; `transitionOrder` continues to own `status` exclusively. `categoria` remains patchable after creation because a technician may discover the service actually performed differs from what was booked. `observaciones` records what the customer asked for at booking time; it MAY also be set at creation (see Service Order Creation (R20)) and remains patchable afterward for correction. `hallazgos` and `recomendaciones` record technician findings produced only once the vehicle has been examined, so they MUST NOT appear in the create dialog and MUST be settable only through this patch path.

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

### Requirement: Service Order Detail Displays Vehicle, Category, and Notes

The order detail view MUST display the order's vehicle (identified at minimum by plate) as a link to that vehicle's detail screen, its `categoria`, and its `hallazgos`/`recomendaciones`/`observaciones` fields. A field not yet set MUST render an explicit empty-state placeholder, never a blank row. An order whose vehicle has been deactivated (soft-deleted) MUST still render its vehicle identity and link, exactly as for an active vehicle.

#### Scenarios

- GIVEN an order with a vehicle and a `categoria` WHEN staff opens its detail view THEN the system MUST show the vehicle's plate as a link to `/customers/[id]/vehicles/[vehicleId]` and the `categoria` as text
- GIVEN an order that has not yet been completed WHEN staff opens its detail view THEN the system MUST show a placeholder for each unset note field
- GIVEN an order whose vehicle has since been deactivated WHEN staff opens the order's detail view THEN the system MUST still show that vehicle's identity and link

### Requirement: Status Lifecycle Transitions (R21)

An `orden_servicio` MUST have a status of `open`, `in_progress`, `done`, or `cancelled`. The ONLY valid transitions are: `open → in_progress`, `in_progress → done`, `open → cancelled`, and `in_progress → cancelled`. `done` and `cancelled` MUST be terminal states — no transition out of either is valid. Direct `open → done` (skipping `in_progress`) MUST be rejected. Every transition MUST record the timestamp at which it occurred.

#### Scenarios

- GIVEN an order in `open` WHEN staff transitions it to `in_progress` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `in_progress` WHEN staff transitions it to `done` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `open` WHEN staff attempts to transition it directly to `done` THEN the system MUST reject the transition
- GIVEN an order in `open` WHEN staff cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `in_progress` WHEN staff cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `done` WHEN staff attempts any further transition THEN the system MUST reject it because `done` is terminal
- GIVEN an order in `cancelled` WHEN staff attempts any further transition THEN the system MUST reject it because `cancelled` is terminal

### Requirement: Parts Usage Recording — No Automatic Stock Deduction (R22)

**Precondition currently unreachable, rule retained.** `service-order-intake-and-print` removed the parts cart from order creation and left `ordenServicioItem` with no writer of any kind, so "attaching a `producto` to a service order" cannot occur today and the scenarios below describe an action no code path performs. The rule is kept rather than deleted for two reasons: recording parts actually used is a named follow-up of that change, and the no-deduction ruling is a standing architectural decision in `AGENTS.md` that any future writer must inherit. Read this requirement as the contract that flow MUST satisfy, not as a description of behaviour that exists.

Attaching a `producto` to a service order MUST be a record-only action: it captures which parts were used and in what quantity for that order's history. It MUST NOT modify `producto.stock`. *Rationale: this app has no existing real-time stock-deduction mechanism anywhere today — `producto.stock` is a read-only projection that inventory-sync overwrites wholesale on each sync run (see `src/modules/inventory-sync/job.ts`'s `onConflictDoUpdate`, which unconditionally sets `stock` from the synced API payload). Introducing deduction here would invent a stock-tracking concept the rest of the app does not have and cannot keep consistent — out of scope per the proposal ("...inventory deduction on parts use" is explicitly listed as Out of Scope).*

#### Scenarios

- GIVEN a `producto` with `stock = 10` WHEN staff attaches 3 units of it to a service order THEN the system MUST record `quantity = 3` on the order's line item AND MUST NOT change `producto.stock`
- GIVEN a service order with parts already attached WHEN the next scheduled or manual inventory sync runs THEN `producto.stock` MUST be overwritten by the sync exactly as it is today, unaffected by any service-order activity
- GIVEN staff view a service order's parts list WHEN it renders THEN the system MUST clearly present it as "parts used" history, not as a live/remaining-stock indicator

### Requirement: Async Customer Selection in Order Creation (R23)

When creating or editing an `orden_servicio`, the customer picker MUST query customer search asynchronously (debounced, as staff types) instead of preloading the full customer list. A customer already selected on an order being edited MUST be resolved and rendered by id, even when it matches no current search term. WHEN a search yields zero exact matches, the picker MUST render near matches as the primary content, above any inline "create customer" affordance. The create affordance MUST appear only as a secondary action after the near matches, and MUST require `customers.write`; a user with only `customers.read` MUST see near matches with no create option. Every route (list, create, detail, status transition) MUST call `can()` for `service-orders.read`/`service-orders.write` after `requireSession()`, enforcing default-deny policy.

#### Scenarios

- GIVEN the service-order creation page loads WHEN it renders THEN the system MUST NOT preload any customer rows; a query MUST fire only once staff types a search term
- GIVEN the picker is handed an already-resolved customer by its parent AND the current search term matches no rows, or matches rows that exclude that customer WHEN the picker renders THEN it MUST render that customer as its selected option, without issuing a query to find it
- GIVEN a search with zero exact matches but at least one near match WHEN the picker renders its empty state for a user with `customers.write` THEN the near matches MUST render first, and "create customer" MUST render only after them, never beside or above them
- GIVEN the same zero-exact-match search, but a user with only `customers.read` WHEN the picker renders its empty state THEN the system MUST show the near matches with no "create customer" action
- GIVEN a search term with no exact and no near matches WHEN the picker renders its empty state THEN the system MUST show an explicit no-matches message, followed by the create-customer affordance when `customers.write` is held
- AND a user without `customers.write` MUST still see that message, because rendering nothing is indistinguishable from a search that has not finished
- GIVEN a `tecnico` with a valid session WHEN they call any service-order route THEN `can()` MUST evaluate `true` and the request MUST succeed exactly as it does today
- GIVEN an `administrador` with a valid session WHEN they call any service-order route THEN `can()` MUST evaluate `true` and the request MUST succeed

### Requirement: Bulk Status Change Constrained to Legal Transitions

Staff MUST be able to select service orders in the list view (per
`table-bulk-actions`) and change their status in bulk. The status-change
menu MUST offer only the target statuses that are legal, via
`getAllowedTransitions`, for EVERY row in the current selection — the
intersection of each selected row's legal next states, not the union, and
not every status unconditionally. The bulk action MUST apply
`assertTransition` per row against that row's CURRENT status, looping the
existing single-order transition call sequentially; it MUST NOT read every
row's status once and apply a single batched update.

Because a bulk transition to `done` or `cancelled` is terminal and cannot be
undone through the UI, the confirmation step MUST say so before the action
runs.

#### Scenarios

- GIVEN a selection of 4 orders, 3 `open` and 1 `in_progress`
- WHEN staff opens the bulk status menu
- THEN it MUST offer only `cancelled` — the one status legal from every selected row's current status — and MUST NOT offer `in_progress` or `done`

- GIVEN a selection of 3 `open` orders, one of which another session transitions to `done` before the bulk action runs
- WHEN staff applies "Cancelar" to the original selection
- THEN the system MUST cancel the 2 orders still `open` and report the third by id with the reason its current status no longer allows that transition

- GIVEN a bulk transition targeting `done` or `cancelled`
- WHEN staff confirms the action
- THEN the confirmation copy MUST state that the change cannot be undone through the UI

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

The sheet MUST identify the workshop that produced it, carrying the `workshop_config` singleton's name and logo — the same record and the same `/api/workshop-config/logo` route the generated catalog already consumes. Both columns are nullable and each renders only when set: a missing logo MUST leave no broken image.

Field labels MUST be red, unconditionally rather than `print:`-scoped, so the sheet reads the same on screen and on paper.

The view MUST offer a control back to the order it prints, and that control — like the print control itself — MUST be absent from the printed sheet.

Printing MUST produce a light sheet regardless of the app's theme. The `(app)` shell paints `body` and its content container from the theme, so with a dark theme selected the shell prints as a black page around a white sheet; the print rules MUST force those surfaces light rather than relying on the browser's per-user "background graphics" setting.

#### Scenario: The sheet names the workshop
- GIVEN a `workshop_config` row with a name and a logo
- WHEN the print view renders
- THEN the sheet MUST show that name and that logo

#### Scenario: A workshop with no logo prints no broken image
- GIVEN a `workshop_config` row whose logo is unset
- WHEN the print view renders
- THEN no image element MUST be rendered

#### Scenario: The back control never reaches the paper
- GIVEN the print view
- WHEN it renders
- THEN it MUST offer a control back to that order, excluded from the printed output

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

### Requirement: Order List Search Matches Customer, Vehicle, and Phone

The `/service-orders` list MUST support a search filter that matches, case-
and accent-insensitively, against the order's customer `name`, vehicle
`plate`, or customer `phone` — the same three columns `buildClienteSearchWhere`
already matches for `/customers`. It MUST NOT match against `description`
(unindexed free text with no user-meaningful match, the same reason it is
excluded from `ORDEN_SORT`). The input itself follows `list-search-filters`'
controlled-input contract.

#### Scenario: Search matches by customer name
- GIVEN an order belonging to customer "Pérez"
- WHEN staff searches "perez" (no accent)
- THEN that order MUST appear in the results

#### Scenario: Search matches by vehicle plate
- GIVEN an order whose vehicle has plate "AB1234"
- WHEN staff searches "AB1234"
- THEN that order MUST appear in the results

#### Scenario: Search matches by customer phone
- GIVEN an order belonging to a customer with phone "61234567"
- WHEN staff searches "61234567"
- THEN that order MUST appear in the results

#### Scenario: Search does not match description
- GIVEN an order whose `description` contains a word absent from its customer's name, phone, and vehicle plate
- WHEN staff searches that word
- THEN that order MUST NOT appear in the results

### Requirement: Order List Columns Show Customer and Vehicle

The `/service-orders` list MUST render columns: a truncated `ID`, `Cliente`
(customer name), `Vehículo`, `Estado`, `Cita`, and `Acciones`. The `Vehículo`
cell MUST identify the car, not merely its registration: the plate AND the
make/model the workshop knows it by. The owner asked for "el auto con su
placa" and selected a mockup reading `AB-1234 Hilux`; a plate alone does not
tell a technician which car is on the lift. Make and model are nullable, so
the cell MUST degrade to the plate alone when they are absent rather than
rendering a dangling separator. It MUST NOT render a `Descripción` column. `ID` MUST display only
the first 8 characters of the order's id, in a monospace style; this is
DISPLAY-ONLY — the stored `id` MUST remain the full UUID, and the order
detail page MUST continue to show the full UUID.

#### Scenario: List shows customer and the car, not just its plate
- GIVEN an order for customer "Pérez" with a vehicle whose plate is "AB1234", make "Toyota" and model "Hilux"
- WHEN that row renders
- THEN it MUST show "Pérez" under `Cliente`, and the `Vehículo` cell MUST carry both "AB1234" and the make/model

#### Scenario: A vehicle with no make or model still renders its plate
- GIVEN an order whose vehicle has `make = NULL` and `model = NULL`
- WHEN that row renders
- THEN the `Vehículo` cell MUST show the plate alone, with no trailing separator or empty segment

#### Scenario: Descripción column is gone
- GIVEN the order list renders
- WHEN the header row is inspected
- THEN it MUST NOT contain a `Descripción` header

#### Scenario: ID renders truncated
- GIVEN an order with id `87cceecc-...`
- WHEN its row renders
- THEN the `ID` cell MUST display exactly `87cceecc` in a monospace style

#### Scenario: Detail page still shows the full id
- GIVEN an order whose list row shows a truncated id
- WHEN staff opens that order's detail page
- THEN the detail page MUST display the full, untruncated UUID

### Requirement: Unsorted Default Order Is Appointment-First

When no `sort` is present in the URL, `/service-orders` MUST order rows by
`appointmentAt` descending, NULLs last, breaking ties with `createdAt`
descending. `ORDEN_SORT` (`id`, `status`, `appointmentAt`) is UNCHANGED by
this requirement — sorting by customer name or vehicle plate is explicitly
out of scope; it would require a joined `ORDER BY` with `unaccent`/`lower`
wrapping, new SQL this change does not add.

#### Scenario: Orders with an appointment sort newest-first
- GIVEN two orders with `appointmentAt` a week apart and no `sort` in the URL
- WHEN the list renders
- THEN the order with the later `appointmentAt` MUST appear first

#### Scenario: Orders without an appointment sort last
- GIVEN one order with `appointmentAt` set and one with `appointmentAt = NULL`, no `sort` in the URL
- WHEN the list renders
- THEN the order with no appointment MUST appear after the one with an appointment

#### Scenario: appointmentAt and createdAt disagreeing exposes the correct order
- GIVEN order A created today with `appointmentAt` next week, and order B created last week with `appointmentAt` yesterday, no `sort` in the URL
- WHEN the list renders
- THEN order A MUST appear before order B — it sorts by `appointmentAt`, not `createdAt`

### Requirement: Service Due Reminder Restricted to Preventive and Corrective Categories

Transitioning an order to `done` MUST schedule a `service_due` reminder ONLY
when that order's `categoria` is `mant_preventivo` or `mant_correctivo`.
Transitioning an order of any other category (`instalacion`, `reparacion`,
`revisado`) to `done` MUST NOT schedule a `service_due` reminder. This
REMOVES the `service_due` reminder for those three categories — behavior the
code currently provides (all five categories schedule it) but that has never
been specified until now. `revisado`'s own annual (not 90-day) reminder is a
named follow-up, not delivered by this requirement.

#### Scenario: Preventive maintenance schedules service_due
- GIVEN an order with `categoria = "mant_preventivo"`
- WHEN it transitions to `done`
- THEN a `service_due` reminder MUST be scheduled

#### Scenario: Corrective maintenance schedules service_due
- GIVEN an order with `categoria = "mant_correctivo"`
- WHEN it transitions to `done`
- THEN a `service_due` reminder MUST be scheduled

#### Scenario: Installation no longer schedules service_due
- GIVEN an order with `categoria = "instalacion"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled

#### Scenario: Repair no longer schedules service_due
- GIVEN an order with `categoria = "reparacion"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled

#### Scenario: REVISADO no longer schedules service_due
- GIVEN an order with `categoria = "revisado"`
- WHEN it transitions to `done`
- THEN no `service_due` reminder MUST be scheduled
