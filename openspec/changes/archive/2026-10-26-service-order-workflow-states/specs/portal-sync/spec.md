# Delta Spec: portal-sync

The portal keeps its four customer-facing labels and needs no deploy: the workshop maps the new internal statuses onto them and withholds orders the portal cannot hold. Tag **[e2e]** = SQL value; **[unit]** = pure builder/parser.

## MODIFIED Requirements

### Requirement: Payload Whitelist

The snapshot pushed for a customer MUST contain exactly these fields and no others:

- Per customer: the SHA-256 hash of the current portal token and a `version`.
- Per vehicle: vehicle id, `plate`, `make`, `model`, `year`.
- Per order: order id, customer-facing status label, `categoria`, `created_at`, `appointment_at`, `completed_at`, `description`, `hallazgos`, `recomendaciones`, and the id of its vehicle.

The snapshot MUST NEVER contain: customer name, phone, email, `documento_identidad`, reminder opt-outs; vehicle `chasis`, colours, estilo, motor, unit number, `placa_renovacion_mes`, `placa_municipio`, `seguro_vence`; order `observaciones`, intake readings (kilometraje, fuel, battery), technician names, work lines, minutes, corrections, `created_by`, internal status, the on-hold reason, status history, or photos. A field absent from the whitelist MUST be impossible to add by selecting a whole row: the builder MUST construct the payload field by field.

The customer-facing label MUST be one of exactly "Recibida", "En proceso", "Terminada", "Cancelada": `open` → "Recibida"; `diagnosing`, `in_progress`, `on_hold` and `ready_for_review` → "En proceso"; `done` → "Terminada"; `cancelled` → "Cancelada".

An order MUST NOT be included when it is `booked`, or when it has no vehicle or no `categoria` (which also covers a booked order cancelled as a no-show). Such orders are withheld, never sent with a null vehicle or category, because the portal rejects a whole ingest on a missing `categoria` or an unknown status.

Soft-deleted vehicles and the orders of a soft-deleted vehicle MUST NOT be included.

The plaintext token MUST NEVER be sent; only its hash.
(Previously: label map covered five statuses; no exclusion of booked or vehicle-less orders; the on-hold reason and status history were not named in the NEVER list.)

#### Scenario: Payload contains only whitelisted keys
- GIVEN a customer whose rows hold sentinel values in every non-whitelisted column
- WHEN the snapshot is built
- THEN the serialized payload MUST contain none of the sentinels and MUST have only the whitelisted keys at every level

#### Scenario: Internal status never leaves
- GIVEN orders in `open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`, `done` and `cancelled`
- WHEN the snapshot is built
- THEN the statuses MUST be "Recibida", "En proceso", "En proceso", "En proceso", "En proceso", "Terminada" and "Cancelada" respectively, and no internal status string and no on-hold reason MUST appear **[unit]**

#### Scenario: Booked order withheld **[e2e]**
- GIVEN a consented customer with one `booked` order and one `open` order
- WHEN the snapshot is built
- THEN only the `open` order MUST be present

#### Scenario: No-show cancelled without a vehicle withheld **[e2e]**
- GIVEN a `cancelled` order that was cancelled from `booked` with null vehicle and category
- WHEN the snapshot is built
- THEN that order MUST be absent and the build MUST NOT error

#### Scenario: Every snapshot is accepted by the portal's parser **[unit]**
- GIVEN snapshots built from orders in every status, with and without vehicles
- WHEN each is parsed with the portal's ingest parser
- THEN every parse MUST succeed

#### Scenario: Soft-deleted vehicle excluded
- GIVEN a customer with one active and one soft-deleted vehicle, each with orders
- WHEN the snapshot is built
- THEN only the active vehicle and its orders MUST be present

#### Scenario: Token never in the payload
- GIVEN a customer holding a plaintext token
- WHEN the snapshot is built and serialized
- THEN the plaintext token MUST NOT appear anywhere in it

### Requirement: Mutations Trigger a Sync

A sync job for the affected customer MUST be enqueued after every committed change that can alter eligibility or the snapshot: consent recorded or revoked; token issued, rotated or revoked; customer deactivated or reactivated; a vehicle added, edited, soft-deleted or restored; an order created, edited (including `description`, `categoria`, `hallazgos`, `recomendaciones`, dates, and the vehicle or category of a booked order), transitioned in status by any path (manual, bulk, readiness, or the automatic `open → diagnosing`), or cancelled. The enqueue MUST happen after the transaction commits and a failure to enqueue MUST NOT roll back or fail the mutation the operator already made; the nightly reconcile is the safety net for a missed trigger. Enqueueing MUST be idempotent per customer so a burst of edits does not produce unbounded jobs.
(Previously: status changes by the manual route only were named; vehicle/category of a booked order and automatic transitions were not.)

#### Scenario: Order status change triggers a push
- GIVEN a consented customer's order
- WHEN staff transitions it to done
- THEN a sync job for that customer MUST be enqueued and the portal MUST show "Terminada" once it runs

#### Scenario: Receiving a booked order makes it appear **[e2e]**
- GIVEN a consented customer's `booked` order, completed with a vehicle and category
- WHEN staff receives it
- THEN a sync job MUST be enqueued and the next snapshot MUST include the order as "Recibida" (or "En proceso" if a technician continued it to `diagnosing`)

#### Scenario: Automatic diagnosing triggers a push **[e2e]**
- GIVEN a consented customer's `open` order
- WHEN the first technician is assigned and the order becomes `diagnosing`
- THEN a sync job for that customer MUST be enqueued

#### Scenario: Enqueue failure does not fail the mutation
- GIVEN the job queue is unavailable
- WHEN staff edits an order's `hallazgos`
- THEN the edit MUST persist and succeed

#### Scenario: Customer without consent enqueues no outbound push
- GIVEN a customer who never consented
- WHEN staff edits one of their orders
- THEN no snapshot MUST be sent for them
