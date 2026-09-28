# Database Backup Specification

## Purpose

Automated, verified, off-site backup of the workshop Postgres database with a
heartbeat that alerts the owner when a scheduled backup does not complete
successfully.

## Requirements

### Requirement: Backup Verification Pipeline Order

The system MUST run backup steps in this exact order: send an `in_progress`
heartbeat check-in, dump the database with `pg_dump -Fc`, confirm the dump
file is non-empty, run `pg_restore -l` against the dump, perform a scratch
restore with `--exit-on-error`, upload the dump and `service.log`, then send
an `ok` heartbeat check-in. The system MUST NOT upload a dump that failed any
verification step. Whenever any step fails it MUST send an `error` check-in
and, because the cron check-in body has no message field, a separate Sentry
event that names the failed step, so the cause is visible without reading the
PC's log; the log MUST name the step as well.

#### Scenario: Full pipeline succeeds

- GIVEN a healthy Postgres instance and valid R2/Sentry credentials
- WHEN the backup task runs
- THEN the dump file and `service.log` are both uploaded
- AND the heartbeat check-in reports `ok`

#### Scenario: Corrupt dump never uploads

- GIVEN `pg_restore -l` or the scratch restore fails against the dump
- WHEN the backup task runs
- THEN neither the dump nor `service.log` is uploaded
- AND the heartbeat check-in reports `error`
- AND a Sentry event names the failed step

#### Scenario: in_progress is sent before the dump starts

- WHEN the backup task starts
- THEN the `in_progress` check-in is sent before `pg_dump` begins

### Requirement: Scratch Restore Safety

The system MUST verify each dump with a scratch restore against a fixed
database named `dforce_verify`, MUST NOT pass `-C`/`--create` to `pg_restore`
during verification, and MUST drop the `dforce_verify` database afterward
even if the restore fails.

#### Scenario: Scratch database is dropped after failure

- GIVEN the scratch restore into `dforce_verify` fails with `--exit-on-error`
- WHEN the verification step completes
- THEN the `dforce_verify` database no longer exists
- AND the production database was never targeted by `-C`/`--create`

### Requirement: Manual Verification of an Existing Dump

The system MUST provide `standalone.ps1 verify-dump <file>`, which runs the
same scratch-restore verification the backup uses against an existing dump.
It MUST accept only an existing regular file whose name ends in `.dump`, and
MUST reject anything else before logging, reporting or renaming. It MUST NOT
send a cron check-in and MUST NOT upload anything: a manual check of an old
file is not a backup run.

#### Scenario: A corrupt dump is caught without touching the monitor

- GIVEN a dump file that `pg_restore` cannot read to the end
- WHEN `verify-dump` runs against it
- THEN it exits 1, renames the file to `<name>.corrupt`, logs the step and
  sends a Sentry event naming it
- AND no cron check-in is sent and `dforce_verify` no longer exists

#### Scenario: A wrong argument renames nothing

- GIVEN a directory or a file that does not end in `.dump`
- WHEN `verify-dump` runs against it
- THEN it exits 1 with a message that it accepts only a `.dump` file
- AND nothing is renamed, logged or reported

### Requirement: Heartbeat via Sentry Cron Monitor

The system MUST report backup status to Sentry Cron Monitors over plain HTTP
using the org id, project id, and public key derived from `SENTRY_DSN`, and
MUST upsert `monitor_config` with a `0 12 * * *` crontab, the IANA timezone
from `BACKUP_TIMEZONE` (default `America/Panama`, the workshop timezone already
fixed in `src/shared/datetime.ts`; Windows PowerShell 5.1 cannot map a Windows
zone id to IANA), and a `checkin_margin` and `max_runtime` expressed in
minutes. When
`SENTRY_DSN` is unset, the system MUST still run the backup, MUST skip the
check-in, and MUST log that the check-in was skipped.

#### Scenario: Missing DSN does not block the backup

- GIVEN `SENTRY_DSN` is empty or unset
- WHEN the backup task runs
- THEN the dump, verification, and upload steps still complete
- AND `service.log` records that the heartbeat check-in was skipped

#### Scenario: Monitor config is upserted on every run

- GIVEN a valid `SENTRY_DSN`
- WHEN the backup task sends any check-in
- THEN the request includes a `monitor_config` upsert with the daily
  crontab, the `BACKUP_TIMEZONE` IANA value, and minute-denominated
  `checkin_margin`/`max_runtime`

### Requirement: Scheduled Task Registration

`standalone.ps1 install-service` MUST register a Windows Scheduled Task
named `DforceCatalogoBackup` that triggers daily at 12:00 as SYSTEM with
`StartWhenAvailable` and `RunOnlyIfNetworkAvailable`, and MUST do so
idempotently (re-running `install-service` MUST NOT create a duplicate
task). `standalone.ps1 uninstall-service` MUST remove
`DforceCatalogoBackup`.

#### Scenario: Re-running install-service is idempotent

- GIVEN `DforceCatalogoBackup` is already registered
- WHEN `install-service` runs again
- THEN exactly one `DforceCatalogoBackup` task exists afterward

#### Scenario: uninstall-service removes the task

- GIVEN `DforceCatalogoBackup` is registered
- WHEN `uninstall-service` runs
- THEN `DforceCatalogoBackup` no longer exists in Task Scheduler

### Requirement: Off-Site Upload Under a Retention-Ready Prefix

The system MUST upload each dump and its `service.log` to R2 under a
`backups/` key prefix using `@aws-sdk/client-s3` with `region: "auto"` and
both `requestChecksumCalculation` and `responseChecksumValidation` set to
`"WHEN_REQUIRED"`. The system MUST NOT contain any code that deletes
uploaded backups; retention MUST be delivered as a one-time, documented
`wrangler r2 bucket lifecycle` command scoped to the `backups/` prefix. When
any `R2_*` variable is unset, the system MUST still run and verify the
backup locally, MUST skip the upload, and MUST send an `error` heartbeat
check-in.

#### Scenario: Successful upload lands under the prefix

- GIVEN valid `R2_*` credentials
- WHEN a verified dump is uploaded
- THEN both the dump and `service.log` keys start with `backups/`

#### Scenario: Missing R2 credentials still alerts

- GIVEN any `R2_*` variable is unset
- WHEN the backup task runs
- THEN the dump is produced and verified locally, the upload is skipped,
  and the heartbeat check-in reports `error`

### Requirement: Documentation Stays Command-Identical

`WINDOWS.md` and `WINDOWS.es.md` MUST change together and MUST contain
identical commands for `install-service`/`uninstall-service` and backup
configuration. `STANDALONE.md` MUST gain a parity note about the missing
macOS equivalent, and `env.example` MUST list the new backup- and
Sentry-related environment keys.

#### Scenario: English and Spanish docs match on commands

- GIVEN a documented backup command in `WINDOWS.md`
- WHEN the equivalent section in `WINDOWS.es.md` is compared
- THEN the shell command text is identical between both files
