# Spec: service-order-status-history

New capability. Every change of an order's status leaves one append-only history row, so the later timer and live board have something to read. Scenarios tagged **[e2e]** have their value in SQL (history rows, constraints, locking) and MUST be proven against a real Postgres: injected-seam unit tests prove zero real-SQL coverage. **[unit]** scenarios are pure.

## Requirements

### Requirement: One History Row Per Status Change, From Every Writer

Every committed change of `orden_servicio.status` MUST write exactly one `orden_estado_historial` row in the same transaction as the change, so neither can exist without the other. A row MUST carry: the order, the previous status (null on the creation row), the new status, the on-hold reason when the new status is `on_hold` (null otherwise), the acting user (nullable), and the time of the change (defaults to now). This holds for EVERY writer: order creation, the manual transition route (including each row of a bulk change), the readiness recomputation (`in_progress → ready_for_review` and the un-mark `ready_for_review → in_progress`), the automatic `open → diagnosing`, and the assignment that returns a `ready_for_review` order to `in_progress`. An operation that does not change the status (a no-op assignment, an assignment that triggers no transition, a refused transition) MUST write no row. Automatic changes MUST record the user whose action triggered them.

#### Scenario: Creation as Agendada writes one row **[e2e]**
- GIVEN an administrador creates an order as `booked`
- WHEN the order is committed
- THEN exactly one row MUST exist: from null, to `booked`, acting user = the creator

#### Scenario: Walk-in with a technician writes two rows **[e2e]**
- GIVEN an administrador creates an order as `open` naming one active technician
- WHEN the order is committed
- THEN two rows MUST exist in order: null → `open`, then `open` → `diagnosing`, and the order's status MUST be `diagnosing`

#### Scenario: Manual transition writes one row **[e2e]**
- GIVEN a `diagnosing` order
- WHEN a jefe_taller transitions it to `in_progress`
- THEN exactly one new row MUST exist: `diagnosing` → `in_progress`, acting user = the jefe

#### Scenario: Readiness writes a row in both directions **[e2e]**
- GIVEN an `in_progress` order whose last technician marks "Mi parte lista"
- WHEN the mark commits THEN a row `in_progress` → `ready_for_review` MUST exist; WHEN that technician then un-marks THEN a row `ready_for_review` → `in_progress` MUST exist

#### Scenario: Assignment during review writes a row **[e2e]**
- GIVEN a `ready_for_review` order
- WHEN an administrador assigns another technician
- THEN a row `ready_for_review` → `in_progress` MUST exist

#### Scenario: Auto-transition on first assignment writes a row **[e2e]**
- GIVEN an `open` order with no technician
- WHEN a jefe assigns the first technician
- THEN a row `open` → `diagnosing` MUST exist, acting user = the jefe

#### Scenario: No change, no row **[e2e]**
- GIVEN a `diagnosing` order assigned to T
- WHEN an administrador assigns T again, or assigns a second technician U
- THEN no history row MUST be written

#### Scenario: Status and row are atomic **[e2e]**
- GIVEN a transition whose history insert fails
- WHEN the transaction ends
- THEN the order's status MUST be unchanged and no row MUST exist

#### Scenario: Concurrent first assignments transition once **[e2e]**
- GIVEN an `open` order with no technician
- WHEN two jefes assign two different technicians at the same time
- THEN both assignments MUST persist and exactly one `open` → `diagnosing` row MUST exist

### Requirement: History Records the On-Hold Reason

A row whose new status is `on_hold` MUST carry the reason (`repuesto` or `aprobacion_cliente`) the transition supplied; every other row MUST carry none.

#### Scenario: Reason copied **[e2e]**
- GIVEN an `in_progress` order
- WHEN a jefe puts it on hold with reason `repuesto`, then resumes it
- THEN the first new row MUST read `in_progress` → `on_hold` with `repuesto`, and the second `on_hold` → `in_progress` with no reason

### Requirement: History Is Append-Only And Survives Its Actor

No route or service MUST update or delete a history row. An order that has history MUST NOT be deletable (reference restricted by the database). Removing or deactivating the acting user MUST NOT remove the row; the actor becomes unknown.

#### Scenario: No mutation path **[unit]**
- GIVEN the order and status-history modules
- WHEN searched for an update or delete of a history row
- THEN none MUST exist

#### Scenario: Direct delete of an order with history is rejected **[e2e]**
- GIVEN an order with history rows
- WHEN a direct delete of the order is attempted
- THEN the database MUST reject it

#### Scenario: Actor removal keeps the row **[e2e]**
- GIVEN a row written by user X
- WHEN user X is removed
- THEN the row MUST remain with a null actor

### Requirement: Existing Orders Have No Synthetic History

The migration MUST NOT backfill history. Every consumer of history MUST tolerate an order with zero rows: no error, and no invented row. Rows are ordered by time of change, oldest first.

#### Scenario: Pre-existing order renders **[e2e]**
- GIVEN an order created before the migration, with no history rows
- WHEN its detail page and the orders list render
- THEN both MUST render without error

#### Scenario: Migration writes nothing **[e2e]**
- GIVEN a database with orders in `in_progress` and `done`
- WHEN the migration runs
- THEN the history table MUST hold zero rows

#### Scenario: Ordered by time **[e2e]**
- GIVEN an order with three changes committed in sequence
- WHEN its history is read
- THEN the rows MUST come back oldest first
