# Delta for service-orders

## MODIFIED Requirements

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

## ADDED Requirements

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
