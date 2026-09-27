# Error Monitoring Specification

## Purpose

Server, browser, and background-job error reporting to Sentry so app
and job failures are visible to the owner, with no behavior change when
Sentry is not configured.

## Requirements

### Requirement: Sentry Disabled Without a DSN

When `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are both empty or unset, the
system MUST NOT initialize the server or browser Sentry SDK, and MUST
NOT send any event or check-in. The app's behavior MUST be identical to its
behavior before this change.

#### Scenario: Empty DSNs produce no Sentry activity

- GIVEN `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` are both unset
- WHEN the app starts and an error occurs anywhere (server or browser; the app has no edge runtime code)
- THEN no Sentry init runs and no network call to a Sentry ingest host is
  made
- AND the app continues to behave exactly as it did before this change

### Requirement: Server-Side Error Capture Ordering

The system MUST initialize the server Sentry SDK as the first statement of
`instrumentation.ts`'s `nodejs` runtime branch, before the pg-boss worker
bootstrap runs, and MUST export `onRequestError`.

#### Scenario: Bootstrap failure is captured

- GIVEN a valid `SENTRY_DSN`
- WHEN the pg-boss worker bootstrap throws during startup
- THEN the failure is reported to Sentry because the SDK was already
  initialized

### Requirement: Job Failure Capture and Rethrow

The system MUST wrap each of the four `boss.work()` handlers
(inventory-sync, reminders, pdf-upload/upload-status, pdf-generation) so
that a thrown exception is reported to Sentry tagged with the job name and
job id, and MUST rethrow the exception unchanged afterward.

#### Scenario: A job failure is reported and still fails

- GIVEN a valid `SENTRY_DSN` and one of the four job handlers throws
- WHEN pg-boss invokes that handler
- THEN Sentry receives the error tagged with the job's name and id
- AND the same exception propagates to pg-boss unchanged, preserving
  retry/deadletter behavior

### Requirement: Browser Error Capture on Insecure LAN Context

The system MUST capture unhandled browser errors when the app is loaded
over plain HTTP at a LAN IP address, an insecure context. The system MUST
NOT enable session replay, tracing, or source-map upload.

#### Scenario: An error on the insecure LAN origin reaches Sentry

- GIVEN a valid `NEXT_PUBLIC_SENTRY_DSN` and the app opened at
  `http://192.168.x.x:3000`
- WHEN an unhandled client-side error occurs
- THEN the error is reported to Sentry
- AND no replay, tracing, or source-map data is sent
