# Delta Spec: workshop-reminders (crm-workshop-management)

## ADDED Requirements

### Reminder Trigger and Scheduling (R23)

The system MUST support two reminder types tied to an `orden_servicio`: `service-due` and `appointment`. A `service-due` reminder MUST be scheduled automatically WHEN an order transitions to `done` (R21), for that order's `cliente`, at a date computed as the `done` timestamp plus a configurable follow-up interval (the interval value is a configuration concern, not a hardcoded business rule). An `appointment` reminder MUST be scheduled WHEN staff set an explicit future appointment date/time on a service order, independent of its status. WHEN an order is cancelled or its appointment date changes, any pending reminder tied to it MUST be cancelled or rescheduled accordingly — a stale reminder MUST NOT fire.

#### Scenarios

- GIVEN a service order transitions to `done` WHEN that transition is saved THEN the system MUST schedule a `service-due` reminder for the order's `cliente` at `done_at + configured_interval`
- GIVEN staff set an appointment date on a service order WHEN they save it THEN the system MUST schedule an `appointment` reminder for that date
- GIVEN a service order has a pending reminder and is then cancelled (R21) WHEN the cancellation is saved THEN the system MUST cancel that reminder so it never fires
- GIVEN a service order has a pending `appointment` reminder and staff change the appointment date WHEN they save the new date THEN the system MUST cancel the previously-scheduled job and schedule a new one for the updated date — the old and new reminders MUST NOT both fire

### pg-boss Job Contract and Delivery (R24)

Reminder scheduling and delivery MUST reuse the existing pg-boss singleton pattern (`getBoss()` in `src/shared/jobs/boss.ts`) and the queue-registration conventions established in `src/modules/inventory-sync/job.ts`: an idempotent `ensureQueue` call before every `send`/`schedule`, a dedicated named queue for reminders, and a `boss.work(...)` worker registration with bounded concurrency. The job payload MUST identify the `cliente`, the source `orden_servicio`, the reminder type (`service-due` | `appointment`), and the delivery channel (`whatsapp` | `email`). Each delivery attempt MUST be recorded in an audit trail (mirroring `sync_runs`'s audit pattern) capturing at minimum: reminder id, channel, status, and timestamp — so staff can see what was sent and when.

#### Scenarios

- GIVEN no reminders queue exists yet WHEN the first reminder is scheduled THEN the system MUST create the queue idempotently, without erroring on subsequent scheduling calls
- GIVEN a scheduled reminder job fires WHEN pg-boss invokes the worker THEN the worker MUST check the cliente's channel contactability (R26) before attempting delivery
- GIVEN a reminder job is processed (success, failure, or skip) WHEN processing completes THEN the system MUST persist an audit record with the reminder id, channel, resulting status, and timestamp
- GIVEN staff view a cliente's detail or a reminders log WHEN reminders have been sent for that customer THEN the system MUST show the audit history of what was sent, via which channel, and its outcome

### Send Failure Retry Policy (R25)

WHEN a reminder delivery attempt fails (a Kapso or Resend API error), the system MUST rely on pg-boss's native retry mechanism (a bounded retry limit with backoff) rather than treating the first failure as final. A failure MUST NEVER be silently dropped. WHEN all retries for a given delivery are exhausted, the system MUST persist a `failed` status on that reminder's audit record with the error detail, and this failure MUST be visible to staff (e.g. in the cliente detail view or a reminders log) so they can follow up manually.

#### Scenarios

- GIVEN a reminder send fails due to a transient Kapso or Resend error WHEN the worker throws THEN pg-boss MUST retry the job up to a configured retry limit before giving up
- GIVEN all retries for a reminder are exhausted WHEN the final attempt fails THEN the system MUST persist a `failed` audit status with the error detail rather than discarding the job silently
- GIVEN a reminder ultimately fails after exhausting retries WHEN staff open that cliente's detail view or reminders log THEN the system MUST surface the failure so staff can follow up manually (e.g. call the customer directly)

### Consent / Opt-out (Contactability) (R26)

`cliente` MUST support independent per-channel opt-out flags: `whatsapp_opt_out` and `email_opt_out`, both defaulting to `false` (contactable) until a customer explicitly opts out of a channel. Staff MUST be able to set either flag from the customer edit form (customer-management capability). Every reminder delivery attempt MUST check the relevant opt-out flag AT SEND TIME (not only at scheduling time), because a customer's preference may change between when a reminder is scheduled and when it is due to fire. WHEN a channel is opted out, the system MUST skip delivery on that channel and record the outcome as `opted_out` — distinct from `failed` — so opt-outs are never conflated with delivery errors.

#### Scenarios

- GIVEN a `cliente` with `whatsapp_opt_out = true` WHEN a reminder job attempts delivery via WhatsApp THEN the system MUST NOT call Kapso and MUST record the outcome as `opted_out`
- GIVEN a `cliente` with `email_opt_out = true` WHEN a reminder job attempts delivery via email THEN the system MUST NOT call Resend and MUST record the outcome as `opted_out`
- GIVEN staff mark a cliente as opted out of a channel from the customer edit form WHEN they save THEN the flag MUST persist immediately and apply to any reminder already scheduled for that channel, checked again at send time
- GIVEN a `cliente` opted out of both channels WHEN a reminder's trigger condition fires (e.g. an order is marked `done`) THEN the system MUST still create the reminder's audit record for history, but MUST NOT attempt delivery on either channel
