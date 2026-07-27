# Delta Spec: service-orders (crm-workshop-management)

## ADDED Requirements

### Service Order Creation with Parts (R20)

The system MUST allow staff to create an `orden_servicio` that references exactly one existing `cliente` and zero or more `producto` line items, each with a recorded quantity. A new order MUST be created in `open` status. Each part line item MUST record, at minimum, the `producto` id, a name snapshot (in case the product is later renamed or removed from inventory), and the quantity used.

#### Scenarios

- GIVEN an existing `cliente` WHEN staff creates a new service order with no parts attached THEN the system MUST create the order in `open` status with an empty parts list
- GIVEN an existing `cliente` and an existing `producto` WHEN staff adds that producto to the order with `quantity = 2` THEN the system MUST record a line item with the producto id, its name snapshot, and `quantity = 2`
- GIVEN a `cliente` id that does not exist WHEN staff attempts to create a service order against it THEN the system MUST reject creation with a validation error
- GIVEN an order already has a line item for a given `producto` WHEN staff adds the same producto again THEN the system MUST either merge quantities into the existing line item or add a second line item (implementation MUST pick one and apply it consistently — either is acceptable, but silently dropping the second addition is NOT)

### Status Lifecycle Transitions (R21)

An `orden_servicio` MUST have a status of `open`, `in_progress`, `done`, or `cancelled`. The ONLY valid transitions are: `open → in_progress`, `in_progress → done`, `open → cancelled`, and `in_progress → cancelled`. `done` and `cancelled` MUST be terminal states — no transition out of either is valid. Direct `open → done` (skipping `in_progress`) MUST be rejected. Every transition MUST record the timestamp at which it occurred.

#### Scenarios

- GIVEN an order in `open` WHEN staff transitions it to `in_progress` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `in_progress` WHEN staff transitions it to `done` THEN the system MUST update its status and record the transition timestamp
- GIVEN an order in `open` WHEN staff attempts to transition it directly to `done` THEN the system MUST reject the transition
- GIVEN an order in `open` WHEN staff cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `in_progress` WHEN staff cancels it THEN the system MUST set its status to `cancelled`
- GIVEN an order in `done` WHEN staff attempts any further transition THEN the system MUST reject it because `done` is terminal
- GIVEN an order in `cancelled` WHEN staff attempts any further transition THEN the system MUST reject it because `cancelled` is terminal

### Parts Usage Recording — No Automatic Stock Deduction (R22)

Attaching a `producto` to a service order MUST be a record-only action: it captures which parts were used and in what quantity for that order's history. It MUST NOT modify `producto.stock`. *Rationale: this app has no existing real-time stock-deduction mechanism anywhere today — `producto.stock` is a read-only projection that inventory-sync overwrites wholesale on each sync run (see `src/modules/inventory-sync/job.ts`'s `onConflictDoUpdate`, which unconditionally sets `stock` from the synced API payload). Introducing deduction here would invent a stock-tracking concept the rest of the app does not have and cannot keep consistent — out of scope per the proposal ("...inventory deduction on parts use" is explicitly listed as Out of Scope).*

#### Scenarios

- GIVEN a `producto` with `stock = 10` WHEN staff attaches 3 units of it to a service order THEN the system MUST record `quantity = 3` on the order's line item AND MUST NOT change `producto.stock`
- GIVEN a service order with parts already attached WHEN the next scheduled or manual inventory sync runs THEN `producto.stock` MUST be overwritten by the sync exactly as it is today, unaffected by any service-order activity
- GIVEN staff view a service order's parts list WHEN it renders THEN the system MUST clearly present it as "parts used" history, not as a live/remaining-stock indicator
