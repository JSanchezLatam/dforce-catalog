# Spec: service-orders

This spec consolidates R20–R22 from `crm-workshop-management` (baseline), adds access-control requirements from `crm-shell-settings-rbac`, incorporates R23 from `customer-search-and-picker` (async customer selection), and layers in the mandatory vehicle/category link and completion notes from `service-history-per-vehicle` (C4).

## REQUIREMENTS

### Requirement: Service Order Creation with Parts (R20)

The system MUST allow staff to create an `orden_servicio` that references exactly one existing `cliente`, exactly one existing `vehiculo` belonging to that same `cliente`, a `categoria`, and zero or more `producto` line items, each with a recorded quantity. `orden_servicio.vehiculoId` MUST be NOT NULL and MUST be a foreign key to `vehiculo` with `ON DELETE RESTRICT`. A new order MUST be created in `open` status. Each part line item MUST record, at minimum, the `producto` id, a name snapshot (in case the product is later renamed or removed from inventory), and the quantity used. `hallazgos`, `recomendaciones`, and `observaciones` MUST NOT be settable at creation — see the Category and Completion Notes Editing requirement.
(Previously: creation required only a customer, description, and optional parts; no vehicle or category existed.)

#### Scenarios

- GIVEN an existing `cliente` with an active `vehiculo` WHEN staff creates a service order naming that vehicle, a `categoria`, and no parts THEN the system MUST create the order in `open` status, referencing that vehicle and category, with an empty parts list
- GIVEN an existing `cliente`, a valid `vehiculo`, and an existing `producto` WHEN staff adds that producto to the order with `quantity = 2` THEN the system MUST record a line item with the producto id, its name snapshot, and `quantity = 2`
- GIVEN a `cliente` id that does not exist WHEN staff attempts to create a service order against it THEN the system MUST reject creation with a validation error
- GIVEN an order already has a line item for a given `producto` WHEN staff adds the same producto again THEN the system MUST either merge quantities into the existing line item or add a second line item — silently dropping the second addition is NOT acceptable
- GIVEN a `vehiculoId` that does not correspond to any `vehiculo` row WHEN staff attempts to create a service order naming it THEN the system MUST reject creation with a Spanish validation error and MUST NOT create the order
- GIVEN a `vehiculo` belonging to customer B WHEN staff attempts to create a service order with `clienteId` set to customer A and that vehicle THEN the system MUST reject creation with a Spanish validation error — this is a cross-ownership trust-boundary check, not merely a missing-record check
- GIVEN a `cliente` with zero active vehicles WHEN staff opens the order-creation form for that customer THEN the vehicle picker MUST offer no selectable vehicle, submission MUST be prevented, and the form MUST show a message directing staff to add a vehicle to that customer first

### Requirement: Service Category Vocabulary

The system MUST classify every order under exactly one of five `categoria` values: Instalación, Mant. Preventivo, Mant. Correctivo, Reparación, and REVISADO. REVISADO — Panama's mandatory annual ATTT technical inspection, a legal prerequisite for renewing the vehicle's plate — MUST be modeled as a peer service type alongside the other four, not as an order status. It is independent of `orderStatusEnum` (`open`/`in_progress`/`done`/`cancelled`).

#### Scenarios

- GIVEN the order-creation form WHEN staff opens the category selector THEN REVISADO MUST appear alongside Instalación, Mant. Preventivo, Mant. Correctivo, and Reparación with no distinct treatment
- GIVEN a create or patch request with `categoria` set to a value outside the five enumerated ones WHEN it is submitted THEN the system MUST reject it with a validation error

### Requirement: Category and Completion Notes Editing

The system MUST allow staff to patch an existing order's `categoria`, `hallazgos`, `recomendaciones`, and `observaciones` fields, in addition to the existing `description`/`appointmentAt` patch fields; `transitionOrder` continues to own `status` exclusively. `categoria` remains patchable after creation because a technician may discover the service actually performed differs from what was booked. The three note fields record technician findings produced only once the vehicle has been examined, so they MUST NOT appear in the create dialog and MUST be settable only through this patch path.

#### Scenarios

- GIVEN an order created without any note fields WHEN staff patches it with `hallazgos`, `recomendaciones`, and `observaciones` THEN the system MUST persist all three values on that order
- GIVEN an order created with `categoria = "Mant. Preventivo"` WHEN a technician determines the work performed is actually `"Reparación"` and staff patches the order's `categoria` THEN the system MUST update it and leave every other field unchanged
- GIVEN a create-order request payload that includes `hallazgos` WHEN the order is created THEN the system MUST ignore or reject that field and MUST NOT store it on the new order

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
