# Delta for customer-management

## MODIFIED Requirements

### Requirement: Vehicle Collection Persistence, Soft Delete, and Permanent Deletion

When staff create or update a `cliente`, the system MUST persist any changes to that `cliente`'s vehicle collection (added, edited, soft-deleted, or permanently deleted vehicles) together with any `cliente` field changes in a single database transaction — both succeed or both roll back. A vehicle omitted from an update's vehicle payload MUST be left completely untouched. Editing one vehicle MUST NOT alter any of its sibling vehicles on the same customer.

**Soft deletion**: Deleting a vehicle MUST be a soft delete by default — the system MUST set a `deactivated_at` timestamp to the current time on the `vehiculo` row rather than removing the row. Soft-deleted vehicles MUST be excluded from the customer list-view plate column, R19 search, and `CustomerPicker` display. Restoring a previously soft-deleted vehicle (clearing `deactivated_at` back to NULL) MUST be supported and MUST NOT lose any of that vehicle's recorded fields. A vehicle with existing `orden_servicio` history MUST remain soft-deletable exactly like one without history — soft deletion never removes the row, so it is never a referential-integrity concern. This is the first soft-delete pattern introduced in the customer-facing code; its `deactivated_at` nullable-timestamp column and NULL/non-NULL semantics on the owned row set the standing convention any later soft-delete feature MUST follow, rather than inventing its own shape.

**Permanent deletion**: The system MUST also provide permanent deletion of a vehicle — physically removing the row — as a separate operation from soft deletion. Permanent deletion MUST be gated by the `customers.deleteVehicle` policy action, which MUST be `false` for `tecnico` and `true` for `administrador`. A `tecnico` presented with the UI MUST see only the soft-delete (deactivate) affordance. Permanent deletion MUST be included in the collection update payload alongside soft-delete and edit operations, and MUST be rejected with 403 Forbidden before any validation or database work if the requesting user lacks `customers.deleteVehicle` authority. Permanent deletion of a vehicle that has one or more `orden_servicio` rows referencing it MUST additionally be refused: the check MUST run inside the same database transaction as the DELETE, immediately before it, querying `orden_servicio` for any row whose `vehiculoId` is in the delete set, and MUST reject the whole request with a Spanish `ClienteValidationError` under the bare `vehicles` key — the same 400 shape `CustomerForm` already renders — instead of a raw foreign-key-violation 500. `ON DELETE RESTRICT` on `orden_servicio.vehiculoId` remains the backstop for any path that bypasses this check.

The schema migration that introduces `vehiculo` MUST preserve existing data: for every `cliente` row that had any inline vehicle field set, the migration MUST create exactly one `vehiculo` row carrying that make, model, year, and plate, with `deactivated_at = NULL`.
(Previously: permanent deletion had no referential-integrity check, because `orden_servicio` had no `vehiculoId` column to check.)

#### Scenarios

- GIVEN a `cliente` with one existing active vehicle WHEN staff adds a second vehicle and saves THEN the system MUST insert the new `vehiculo` row and leave the first vehicle's row unchanged, in one transaction with any `cliente` field changes
- GIVEN a `cliente` with two vehicles WHEN staff edits only the first vehicle's plate and saves THEN the system MUST update only that `vehiculo` row, leaving the second vehicle's row and every `cliente` field unchanged
- GIVEN a `cliente` with one active vehicle WHEN staff soft-deletes it THEN the system MUST set that `vehiculo` row's `deactivated_at` timestamp to the current time, MUST NOT delete the row, and the vehicle MUST no longer appear in the list view, R19 search results, or `CustomerPicker`
- GIVEN a previously soft-deleted vehicle WHEN staff restores it THEN the system MUST clear `deactivated_at` back to NULL and the vehicle's make, model, year, and plate MUST be exactly as recorded before the delete
- GIVEN a `cliente` update patch that edits only the phone field and includes no vehicles WHEN staff saves THEN every existing `vehiculo` row for that `cliente` MUST remain unchanged, including each row's `deactivated_at` timestamp
- GIVEN the pre-migration `cliente` row carrying inline vehicle fields WHEN the schema migration runs THEN the system MUST create exactly one `vehiculo` row for it, preserving make, model, year, and plate, with `deactivated_at = NULL`
- GIVEN a `tecnico` with a valid session WHEN they attempt to permanently delete a vehicle THEN the system MUST reject the request with 403 Forbidden before any database work
- GIVEN an `administrador` with a valid session WHEN they permanently delete a vehicle with zero `orden_servicio` rows referencing it THEN the system MUST physically remove that `vehiculo` row from the database in the same transaction as any other `cliente` field changes
- GIVEN a `vehiculo` with one or more `orden_servicio` rows referencing it WHEN an `administrador` attempts to permanently delete it THEN the system MUST reject the request with a Spanish 400 validation error under the `vehicles` key and MUST NOT delete the row
- GIVEN that same `vehiculo` with service history WHEN staff soft-deletes it instead of requesting permanent deletion THEN the system MUST set `deactivated_at` exactly as for a vehicle with no history, and its service-order history MUST remain intact and queryable

## ADDED Requirements

### Requirement: Vehicle Detail Screen with Service History

The system MUST provide a vehicle detail screen at `/customers/[id]/vehicles/[vehicleId]`, reachable by clicking a vehicle card on the customer detail view. The screen MUST show that vehicle's identity fields (plate, make, model, year) and a list of its own `orden_servicio` history, ordered most-recent-first. Each history row MUST offer a detail affordance that navigates to the existing `/service-orders/[id]` page rather than duplicating that page's content. A vehicle with zero service orders MUST show an explicit empty-state message instead of an empty table.

#### Scenarios

- GIVEN a `cliente` detail view WHEN staff clicks one of its vehicle cards THEN the system MUST navigate to that vehicle's `/customers/[id]/vehicles/[vehicleId]` screen
- GIVEN two vehicles belonging to the same customer, each with service orders WHEN staff opens the first vehicle's detail screen THEN the system MUST list only that vehicle's orders, most-recent-first, excluding the second vehicle's orders
- GIVEN a vehicle detail screen with at least one history row WHEN staff clicks that row's detail affordance THEN the system MUST navigate to `/service-orders/[id]` for that exact order
- GIVEN a vehicle with zero `orden_servicio` rows WHEN staff opens its detail screen THEN the system MUST show an empty-state message instead of an empty table
- GIVEN a soft-deleted (deactivated) vehicle that has service-order history WHEN staff navigates directly to its detail screen (e.g. via an order's vehicle link) THEN the system MUST still render the vehicle's identity and its full history
