# Design: Workshop Observability

## Technical Approach

The backup stays in `standalone.ps1`. It uploads through a plain-Node `scripts/upload-backup.mjs`, following the `migrate.mjs` convention. The heartbeat is two `Invoke-RestMethod` POSTs to the cron URL derived from the DSN. App errors go through `@sentry/nextjs`, initialised inline in `src/instrumentation.ts` and `src/instrumentation-client.ts`. Job failures go through `withJobCapture` at the four `boss.work()` sites. External facts come from `exploration.md` and Engram #1164.

## Architecture Decisions

| # | Choice | Rejected (why) |
|---|---|---|
| 1 | Pipeline: `in_progress` → `pg_dump` → non-empty → `pg_restore -l` → `dropdb --if-exists dforce_verify`, `createdb`, `pg_restore -d dforce_verify --exit-on-error --no-owner` (never `-C`), `dropdb` in `finally` → `R2_*` present → `node scripts/upload-backup.mjs <dump> <log>` → `ok` | `-l` only: it passes a truncated dump (#1164) |
| 2 | `Fail` is the single exit. When `$script:BackupStep` is set, it appends to `$SystemLogFile`, then sends the `error` check-in plus one Sentry event `Backup failed at <step>` (envelope endpoint), then `exit 1`. The verify step captures its exit code, drops the database in `finally`, and only then calls `Fail` | A `try/catch` per step: eight duplicated handlers |
| 3 | Exit 0 means verified and uploaded (explicit `exit 0`). Exit 1 means any failure, including missing `R2_*`. A missing DSN is not a failure. `LastTaskResult` reports this directly, which is the reverse of the boot task | Per-step exit codes: the log already names the step |
| 4 | `$env:R2_*` is set from `Get-EnvValue` at run time and cleared in `finally`. argv carries only paths | CLI args are visible in the task definition and the process list |
| 5 | `install-service` runs `ALTER ROLE "dforce" CREATEDB` once through `Invoke-Psql` as superuser, because the role was created without it | Superuser password in `.env` for SYSTEM |
| 6 | Keys: `backups/<dump basename>` and `backups/<basename without .dump>.service.log`. This pairs the dump with its log and keeps the clock out of the code. `S3Client{region:"auto", endpoint, requestChecksumCalculation/responseChecksumValidation:"WHEN_REQUIRED"}`, `PutObject` with `createReadStream` and `ContentLength` from `stat`, no `lib-storage` | `service-<yyyymmdd>.log`: one more clock and timezone to reconcile |
| 7 | Seam: export a pure `buildUploads`. `main()` runs only when `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`, so paths with spaces work (the `migrate.mjs` lesson). A missing log uploads the dump only, with a warning | A mocked-S3 test tests the mock |
| 8 | Cron URL from `[Uri]$dsn`: `https://<Host>/api/<path>/cron/dforce-catalog-backup/<UserInfo>/`. The host is kept verbatim, so regional DSNs (`o1.ingest.us.sentry.io`) work | A regex that hardcodes `ingest.sentry.io` |
| 9 | Every POST upserts `monitor_config`: crontab `0 12 * * *`; `timezone` = `.env` `BACKUP_TIMEZONE`, default `America/Panama` (`WORKSHOP_TIME_ZONE`, `src/shared/datetime.ts:41`); `checkin_margin` 180 min (late boot, `StartWhenAvailable`); `max_runtime` 30 min (seconds for dump and verify, about 7 min to upload 50 MB on a slow uplink, ×4). `check_in_id` is one `[guid]::NewGuid()`, reused on close | Mapping the Windows zone id to IANA: `TryConvertWindowsIdToIanaId` is .NET 6+, and PS 5.1 runs .NET Framework |
| 10 | No DSN: log "heartbeat omitido" and continue. HTTP failure: log and continue (`-TimeoutSec 15`). The Tls12 one-liner goes right after `param()`. A crash mid-run leaves `in_progress` open, and Sentry reports a timeout | Failing the backup when Sentry is unreachable |
| 11 | `Register-BackupTask`, called from `Install-BootTask` (admin already enforced), reuses the SYSTEM principal. Trigger `-Daily -At 12:00`. Settings: `StartWhenAvailable`, `RunOnlyIfNetworkAvailable`, `MultipleInstances IgnoreNew`, `ExecutionTimeLimit` 1h, which is longer than `max_runtime` so Sentry reports first. Action: `standalone.ps1 backup -BackupDir "<resolved>" -NodeDir "<resolved>"`. The new `-NodeDir` prepends PATH, as `service-start.ps1:76` does. `-Force` makes it idempotent. `uninstall-service` unregisters the task, and `status` prints `LastRunTime`/`LastTaskResult` | A second admin command |
| 12 | `Invoke-Restore`'s safety copy calls the extracted `New-Dump`, not the pipeline | An ad-hoc copy firing an upload and a check-in |
| 13 | Server: static `import * as Sentry` in `instrumentation.ts`. The first statement of the `nodejs` branch is `if (process.env.SENTRY_DSN) Sentry.init({dsn, environment: process.env.NODE_ENV})`. Then `registerNodeWorkers()` runs in a `try/catch` that calls `captureException` and rethrows. `export const onRequestError = Sentry.captureRequestError`. It reads `process.env`, not `env.ts`, because `env.ts` throws on a missing `DATABASE_URL` before init | `sentry.server/edge.config.ts`: the Next 16 proxy is Node-only (`proxy.md:223`) and there is no edge code, so separate files add nothing |
| 14 | An explicit DSN guard, so no init runs at all (the spec) | Relying on the SDK treating an `undefined` DSN as disabled |
| 15 | `src/instrumentation-client.ts`: the same guard on `NEXT_PUBLIC_SENTRY_DSN`, which is inlined at build time, so changing it needs a rebuild. No `tracesSampleRate`, no replay integration. Exports `onRouterTransitionStart` | Tracing or replay (out of scope) |
| 16 | `withSentryConfig(nextConfig, {sourcemaps:{disable:true}, release:{create:false}, telemetry:false, silent:true})`, with no `org`/`project` (they are used only for uploads) and no `tunnelRoute` (LAN, no ad-blockers). The release defaults to the build-time git SHA, since `package.json` stays at `0.1.0`. `headers()` is untouched (no CSP). Webpack-only options are omitted (Turbopack) | Dropping the wrapper: it leaves the supported setup and loses release injection |
| 17 | `env.ts`: `SENTRY_DSN: optional()` and an entry in `SENSITIVE_ENV_KEYS` (D3). `NEXT_PUBLIC_SENTRY_DSN` is not listed, because it ships in every browser bundle | Listing a public value as sensitive, which would be a false claim |
| 18 | `withJobCapture` per site. pg-boss `Events` has no per-job failure event (exploration, `types.d.ts`) | A global pg-boss hook, which does not exist |

## Data Flow

    Task 12:00 (SYSTEM) ─→ standalone.ps1 backup ─→ POST cron in_progress
         pg_dump → -l → dforce_verify restore/drop ─→ node upload-backup.mjs ─→ R2 backups/
         any Fail ─→ POST cron error + event ─→ exit 1      success ─→ POST cron ok ─→ exit 0

## File Changes

| File | Action |
|---|---|
| `scripts/windows/standalone.ps1` | Modify: Tls12, `-NodeDir`, `New-Dump`, pipeline, `Send-CheckIn`, `Fail` hook, `Register-BackupTask`, uninstall, status |
| `scripts/upload-backup.mjs`, `.test.mjs` | Create |
| `src/instrumentation.ts`, `.test.ts` | Modify / Create |
| `src/instrumentation-client.ts` | Create |
| `next.config.ts`, `package.json`, `src/shared/config/env.ts` | Modify |
| `src/shared/jobs/capture.ts`, `.test.ts` | Create |
| 4 worker files, `reminders/job.test.ts` | Modify |
| `WINDOWS.md`, `WINDOWS.es.md`, `STANDALONE.md`, `env.example` | Modify |

## Interfaces

```ts
export function withJobCapture<J extends { id: string }>(
  job: string, handler: (jobs: J[]) => Promise<void>,
  report: (e: unknown, ctx: { tags: Record<string, string> }) => void = Sentry.captureException,
): (jobs: J[]) => Promise<void>; // report {job, jobId: jobs[0]?.id}, then rethrow the SAME error
// site: boss.work(NAME, opts, withJobCapture(NAME, async ([job]) => { ... }))
export function buildUploads(dumpPath: string, logPath?: string): { key: string; path: string }[];
```

## Testing Strategy

| Unit | RED test | Not unit-testable → proof |
|---|---|---|
| WU1 | `buildUploads` keys and prefix; log omitted | PowerShell (no Pester): smoke test on the PC. A manual run shows R2 objects and an `ok` check-in; blanking `R2_BUCKET` gives an `error` check-in, exit 1, no upload; `Start-ScheduledTask` gives `LastTaskResult` 0 |
| WU3 | Mocked `@sentry/nextjs`: `init` runs before `registerNodeWorkers` (`invocationCallOrder`); no DSN means no `init`; a bootstrap throw is captured and rethrown | Browser: an error from `http://<LAN-IP>:3000` on a second machine appears in Sentry; network shows no trace or replay items |
| WU4 | report called with tags; the same error is rethrown; `reminders` site: the captured handler still rejects | Real job failure visible in Sentry |

Mutation-verify each: revert the fix, and the test must go red by name.

## Work Units (stacked to `main`, each independently mergeable)

| WU | Files | ~Lines |
|---|---|---|
| 1 Backup code | ps1, upload script and test | 300 |
| 2 Backup docs | `WINDOWS*.md` (automatic backup, SYSTEM holds R2 and DSN, Sentry project, `wrangler r2 bucket lifecycle add <BUCKET> backups-30d backups/ --expire-days 30`, reading the monitor, smoke test), `STANDALONE.md` parity note, `env.example` | 130 |
| 3 Sentry app | instrumentation, `next.config`, `env.ts`, `package.json` (lockfile generated, not counted) | 110 |
| 4 Job wrapper | `capture.ts`, 4 sites, tests | 110 |

Merge order 1→2→3→4, so the heartbeat is live first. Parallel builds (disjoint files): WU1 ∥ WU3, then WU2 ∥ WU4. Total ~650 lines, so chained PRs are required.

## Threat Matrix

Every row is N/A: no git, PR or doc-path classification. Subprocess boundary: secrets pass through the child's environment, never argv, and no check-in or log line prints a value.

## Migration / Rollout

The owner creates the Sentry project and the R2 lifecycle rule once, fills `.env`, and re-runs `install-service`, which prompts for the superuser password (CREATEDB grant). Rollback: revert the PR; `Unregister-ScheduledTask DforceCatalogoBackup`; an empty DSN disables Sentry.

## Open Questions

- [ ] The check-in API has no message field, so "error naming the failed step" is met by an extra Sentry event (decision 2). If the spec relaxes this to "the log names the step", drop about 15 lines.
- [ ] Local dumps are never pruned (existing behavior). Follow-up.
