# Delta Spec: customer-management (vehicle-details-and-renewals)

## ADDED Requirements

### Requirement: Vehicle Descriptive Fields

A vehicle MAY carry chasis, primary color, secondary color (free text), estilo (one of: Sedán, Hatchback, SUV, Pick-up, Van/Panel, Coupé, Moto, Otro), motor (`combustion`, `electrico`, `hibrido`) and unit number. All are optional and MUST NOT change R17's plate rule.

#### Scenario: Fields round-trip
- GIVEN staff on the customer form
- WHEN they save a vehicle with chasis, colors, estilo "SUV", motor `hibrido` and unit "12"
- THEN reopening the form MUST show those values

#### Scenario: Invalid estilo or motor rejected
- GIVEN a save payload with estilo "Cohete" or motor "diesel"
- WHEN submitted
- THEN the system MUST reject it with a validation error

### Requirement: Internal Fields Are Preserved and Gated on Save

Saving a vehicle through any write path MUST NOT overwrite the stored plate renewal month or insurance expiry unless the caller sent them and holds `vencimientos.read`. A caller without it that sends either field MUST be refused with 403 before any database work.

#### Scenario: Technician save preserves internal fields
- GIVEN a vehicle with renewal month 3 and insurance expiry 2026-11-15
- WHEN a tecnico edits its color and saves without those keys
- THEN both stored values MUST be unchanged

#### Scenario: Technician sending internal fields is refused
- GIVEN a tecnico session
- WHEN a vehicle save includes `placa_renovacion_mes` or `seguro_vence`
- THEN the system MUST respond 403 and persist nothing

#### Scenario: Administrador omitting a field preserves it
- GIVEN an administrador saving a vehicle without the insurance key
- WHEN saved
- THEN the stored insurance expiry MUST be unchanged

#### Scenario: Administrador clears explicitly
- GIVEN an administrador sending insurance expiry as null
- WHEN saved
- THEN the stored value MUST become null

### Requirement: Vehicles GET Route Public Shape

`GET /api/customers/[id]/vehicles` MUST return an explicit public shape that never includes the renewal month or insurance expiry, for every role.

#### Scenario: Internal fields absent from the route
- GIVEN a vehicle with sentinel values in both internal fields
- WHEN an administrador calls the route
- THEN the response body MUST contain neither field nor the sentinel values

## MODIFIED Requirements

### Requirement: Vehicle Detail Screen with Service History

The system MUST provide a vehicle detail screen at `/customers/[id]/vehicles/[vehicleId]`, reachable by clicking a vehicle card on the customer detail view. The screen MUST show that vehicle's identity fields (plate, make, model, year, plus any set chasis, colors, estilo, motor and unit number) and a list of its own `orden_servicio` history, ordered most-recent-first. The renewal month and insurance expiry MUST appear only for a session with `vencimientos.read`. Each history row MUST offer a detail affordance that navigates to the existing `/service-orders/[id]` page rather than duplicating that page's content. A vehicle with zero service orders MUST show an explicit empty-state message instead of an empty table.
(Previously: identity fields were plate, make, model, year only.)

#### Scenario: Navigate from vehicle card
- GIVEN a `cliente` detail view
- WHEN staff clicks one of its vehicle cards
- THEN the system MUST navigate to that vehicle's `/customers/[id]/vehicles/[vehicleId]` screen

#### Scenario: Only that vehicle's orders
- GIVEN two vehicles of one customer, each with service orders
- WHEN staff opens the first vehicle's detail screen
- THEN the system MUST list only that vehicle's orders, most-recent-first

#### Scenario: History row opens the order
- GIVEN a vehicle detail screen with at least one history row
- WHEN staff clicks that row's detail affordance
- THEN the system MUST navigate to `/service-orders/[id]` for that exact order

#### Scenario: Empty history
- GIVEN a vehicle with zero `orden_servicio` rows
- WHEN staff opens its detail screen
- THEN the system MUST show an empty-state message instead of an empty table

#### Scenario: Deactivated vehicle still renders
- GIVEN a soft-deleted vehicle with service-order history
- WHEN staff navigates directly to its detail screen
- THEN the system MUST render its identity and full history

#### Scenario: Internal fields hidden from technician
- GIVEN a vehicle with internal values set
- WHEN a tecnico opens its detail screen
- THEN neither internal field MUST be rendered; an administrador MUST see both
