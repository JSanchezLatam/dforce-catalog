# Portal Sync Specification

## Purpose

The workshop's outbound jobs that keep the portal's copy of each consenting customer in step with the workshop database. The portal never reads the workshop; the workshop only pushes.

## Requirements

### Requirement: Payload Whitelist

The snapshot pushed for a customer MUST contain exactly these fields and no others:

- Per customer: the SHA-256 hash of the current portal token and a `version`.
- Per vehicle: vehicle id, `plate`, `make`, `model`, `year`.
- Per order: order id, customer-facing status label, `categoria`, `created_at`, `appointment_at`, `completed_at`, `description`, `hallazgos`, `recomendaciones`, and the id of its vehicle.

The snapshot MUST NEVER contain: customer name, phone, email, `documento_identidad`, reminder opt-outs; vehicle `chasis`, colours, estilo, motor, unit number, `placa_renovacion_mes`, `placa_municipio`, `seguro_vence`; order `observaciones`, intake readings (kilometraje, fuel, battery), technician names, work lines, minutes, corrections, `created_by`, internal status, or photos. A field absent from the whitelist MUST be impossible to add by selecting a whole row: the builder MUST construct the payload field by field.

Soft-deleted vehicles and the orders of a soft-deleted vehicle MUST NOT be included.

The plaintext token MUST NEVER be sent; only its hash.

#### Scenario: Payload contains only whitelisted keys
- GIVEN a customer whose rows hold sentinel values in every non-whitelisted column
- WHEN the snapshot is built
- THEN the serialized payload MUST contain none of the sentinels and MUST have only the whitelisted keys at every level

#### Scenario: Internal status never leaves
- GIVEN orders in `open`, `in_progress`, `ready_for_review`, `done` and `cancelled`
- WHEN the snapshot is built
- THEN the statuses MUST be "Recibida", "En proceso", "En proceso", "Terminada" and "Cancelada" respectively, and no internal status string MUST appear

#### Scenario: Soft-deleted vehicle excluded
- GIVEN a customer with one active and one soft-deleted vehicle, each with orders
- WHEN the snapshot is built
- THEN only the active vehicle and its orders MUST be present

#### Scenario: Token never in the payload
- GIVEN a customer holding a plaintext token
- WHEN the snapshot is built and serialized
- THEN the plaintext token MUST NOT appear anywhere in it

### Requirement: Eligibility Decides Upsert or Delete

A customer MUST be pushed as an upsert only when ALL hold: the customer holds a current consent, the customer is active, and the portal is configured (`PORTAL_INGEST_URL` and `PORTAL_INGEST_SECRET` set). Otherwise the job MUST push a delete for that customer (or push nothing at all when the portal is not configured). The worker MUST decide at run time from current database state, never from what was true when the job was enqueued, and its payload MUST be only `{clienteId}`.

#### Scenario: Consented active customer is upserted
- GIVEN an active customer with current consent
- WHEN their sync job runs
- THEN the worker MUST push an upsert with a freshly built snapshot

#### Scenario: Consent revoked after enqueue
- GIVEN a job enqueued while consent was current
- WHEN consent is revoked before the job runs
- THEN the worker MUST push a delete and MUST NOT push a snapshot

#### Scenario: Deactivated customer is removed
- GIVEN a consented customer who is then deactivated
- WHEN their sync job runs
- THEN the worker MUST push a delete

#### Scenario: Reactivation restores
- GIVEN a deactivated customer whose consent is still current
- WHEN they are reactivated and the sync job runs
- THEN the worker MUST push an upsert, and the customer's existing token MUST open the portal again

#### Scenario: No consent means no data in the cloud
- GIVEN a customer who never consented
- WHEN a sync job runs for them
- THEN the worker MUST NOT push any snapshot

### Requirement: Rotation and Revocation Invalidate the Old Code

After a token is rotated, the old token MUST resolve to nothing on the portal once the next sync for that customer succeeds. After consent is revoked, the portal MUST hold no snapshot, no token hash and no order data for that customer once the delete succeeds. Whether rotation is delivered as a replacing upsert or as a delete followed by an upsert is an implementation choice, provided the old hash never resolves after the sync.

#### Scenario: Rotation within one sync
- GIVEN a customer whose code is rotated
- WHEN the sync job completes
- THEN the old QR MUST show the neutral page and the new QR MUST open the history

#### Scenario: Revocation within one sync
- GIVEN a customer whose consent is revoked
- WHEN the sync job completes
- THEN the portal MUST hold no snapshot and no token hash for that customer (a data-free tombstone MAY remain until the nightly reconcile), no data MUST be served for that hash, and the old QR MUST show the neutral page

### Requirement: Signed Transport

Every push MUST be an HTTPS request to `PORTAL_INGEST_URL` carrying a timestamp and an HMAC-SHA256 signature over `timestamp.body` computed with `PORTAL_INGEST_SECRET`, accepted by the portal within a 5-minute skew window. The workshop MUST hold only `PORTAL_INGEST_URL` and `PORTAL_INGEST_SECRET` for the cloud side and MUST NOT hold any cloud database credential.

#### Scenario: Outgoing request is signed
- GIVEN a sync job pushing a snapshot
- WHEN the request is sent
- THEN it MUST carry a timestamp and a signature that the portal's verification accepts

#### Scenario: No cloud database credential
- GIVEN the workshop's environment and code
- WHEN its cloud-side configuration is inspected
- THEN it MUST contain no portal database URL or password

### Requirement: Version Ordering

Every push for a customer, upsert or delete, MUST carry a `version` greater than the `version` of any earlier push for that customer, including across worker restarts and the nightly resync. A re-push of unchanged content MUST therefore still carry a greater version, and the portal's newer-version-wins rule (see `customer-portal`) MUST make retried and reordered deliveries safe.

#### Scenario: Retried job does not regress
- GIVEN a push at version 8 that succeeded and an older queued retry at version 7
- WHEN the retry is delivered
- THEN the portal MUST keep the version 8 content

#### Scenario: Two jobs for one customer back to back
- GIVEN two edits to the same customer's orders producing two jobs
- WHEN both run in any order
- THEN the portal MUST end holding the snapshot built by the later-versioned push

### Requirement: Mutations Trigger a Sync

A sync job for the affected customer MUST be enqueued after every committed change that can alter eligibility or the snapshot: consent recorded or revoked; token issued, rotated or revoked; customer deactivated or reactivated; a vehicle added, edited, soft-deleted or restored; an order created, edited (including `description`, `categoria`, `hallazgos`, `recomendaciones`, dates), transitioned in status, or cancelled. The enqueue MUST happen after the transaction commits and a failure to enqueue MUST NOT roll back or fail the mutation the operator already made; the nightly reconcile is the safety net for a missed trigger. Enqueueing MUST be idempotent per customer so a burst of edits does not produce unbounded jobs.

#### Scenario: Order status change triggers a push
- GIVEN a consented customer's order
- WHEN staff transitions it to done
- THEN a sync job for that customer MUST be enqueued and the portal MUST show "Terminada" once it runs

#### Scenario: Enqueue failure does not fail the mutation
- GIVEN the job queue is unavailable
- WHEN staff edits an order's `hallazgos`
- THEN the edit MUST persist and succeed

#### Scenario: Customer without consent enqueues no outbound push
- GIVEN a customer who never consented
- WHEN staff edits one of their orders
- THEN no snapshot MUST be sent for them

### Requirement: Retries, Dead-Letter Queue and Offline Tolerance

A failed push (network error, timeout, or a 5xx) MUST be retried with backoff and, after retries are exhausted, MUST land in a dead-letter queue instead of being dropped. A 4xx other than a stale-version acknowledgement MUST NOT be retried indefinitely. Jobs MUST be persisted, so a workshop that loses its internet connection queues the pushes and delivers them after reconnecting. The portal MUST keep serving the last snapshot while the workshop is offline and MUST show "Actualizado: {fecha}" so the staleness is visible. A dead-lettered customer MUST be retried by the next nightly reconcile.

#### Scenario: Transient failure retried
- GIVEN the portal returns 503 on the first attempt
- WHEN the job runs
- THEN the worker MUST retry with backoff and MUST succeed when the portal recovers

#### Scenario: Exhausted retries go to the dead-letter queue
- GIVEN the portal stays unreachable beyond the retry limit
- WHEN the last retry fails
- THEN the job MUST be moved to the dead-letter queue and MUST NOT be discarded

#### Scenario: Offline workshop catches up
- GIVEN the workshop has no internet while three orders change
- WHEN connectivity returns
- THEN the queued jobs MUST deliver and the portal MUST show the new state

#### Scenario: Stale-version acknowledgement is not a failure
- GIVEN the portal answers 2xx to an upsert it ignored as stale
- WHEN the worker receives it
- THEN the job MUST complete without retry

### Requirement: Nightly Reconcile

A job MUST run nightly and enqueue a sync for every customer that currently holds consent and for every customer that has ever had consent recorded, so that a missed upsert is repaired and a missed delete (revocation, deactivation) is repeated. The reconcile MUST rely on the same eligibility rule as any other sync job and MUST NOT need to read the portal's database.

#### Scenario: Missed trigger heals overnight
- GIVEN an order edit whose enqueue was lost
- WHEN the nightly reconcile runs and completes
- THEN the portal MUST show the edited order

#### Scenario: Missed delete is repeated
- GIVEN a customer whose revocation delete never reached the portal
- WHEN the nightly reconcile runs
- THEN a delete MUST be pushed for that customer

### Requirement: Unconfigured Portal Is Inert

When `PORTAL_INGEST_URL` or `PORTAL_INGEST_SECRET` is unset, the workshop MUST send no request to any portal, MUST NOT fail any mutation or job because of it, and MUST NOT print a QR (see `service-orders`). Setting them again MUST resume syncing through the nightly reconcile.

#### Scenario: Rollback switch
- GIVEN `PORTAL_INGEST_SECRET` unset
- WHEN staff edits a consented customer's order
- THEN no outbound request MUST be made and the edit MUST succeed
