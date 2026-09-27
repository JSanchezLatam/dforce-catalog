# Tasks: Workshop Observability

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650 (WU1 300, WU2 130, WU3 110, WU4 110) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 backup code → PR2 backup docs → PR3 Sentry app → PR4 job wrapper |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (recommended; owner confirms) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test | Runtime harness | Rollback |
|---|---|---|---|---|---|
| 1 | Backup verify+upload+heartbeat+task registration | PR1 | `vitest upload-backup` | `standalone.ps1 backup` on workshop PC; corrupt-dump run | `Unregister-ScheduledTask DforceCatalogoBackup`; delete script |
| 2 | Backup docs | PR2 | N/A (docs) | Diff WINDOWS.md vs .es.md commands | Revert doc files |
| 3 | Sentry app init | PR3 | `vitest instrumentation` | 2nd machine at LAN IP, trigger client error | Empty DSNs disable SDK; revert PR |
| 4 | Job wrapper x4 sites | PR4 | `vitest capture` | Force job throw; check Sentry tags + pg-boss retry | Revert `capture.ts` + 4 sites |

Build pairs (disjoint files): WU1 ∥ WU3, then WU2 ∥ WU4 (WU4 imports `@sentry/nextjs`, needs WU3 available). Merge order: 1→2→3→4.

## Phase 1: Backup Pipeline (WU1, PR1)

- [ ] 1.1 RED `scripts/upload-backup.test.mjs`: `buildUploads` returns `backups/<dump>` + `backups/<base>.service.log` keys; log omitted → dump only.
- [ ] 1.2 GREEN `scripts/upload-backup.mjs`: pure `buildUploads` + `S3Client{region:"auto", requestChecksumCalculation/responseChecksumValidation:"WHEN_REQUIRED"}`; `main()` guarded by `fileURLToPath(import.meta.url)===path.resolve(process.argv[1])`.
- [ ] 1.3 `standalone.ps1`: Tls12 line; `New-Dump`; verify pipeline (`pg_restore -l` → `dforce_verify` createdb/restore/dropdb in `finally`); `Send-CheckIn` (`in_progress`/`ok`/`error`, `monitor_config` upsert, `BACKUP_TIMEZONE` default `America/Panama`); `Fail` hook (log + error check-in + Sentry event naming the step, `exit 1`).
- [ ] 1.4 `Register-BackupTask` in `Install-BootTask` (idempotent, SYSTEM, Daily 12:00, `StartWhenAvailable`/`RunOnlyIfNetworkAvailable`); remove in `uninstall-service`; `LastTaskResult` in `status`.
- [ ] 1.5 `install-service`: grant `ALTER ROLE "dforce" CREATEDB` via superuser `Invoke-Psql`.
- [ ] 1.6 Mutation-verify 1.1: revert `buildUploads`, confirm the RED test fails by name.
- [ ] 1.7 Manual proof (not unit-testable): real `standalone.ps1 backup` run — dump+log in R2, `ok` check-in; corrupted dump copy → `error` check-in + event, no upload.

## Phase 2: Backup Docs (WU2, PR2)

- [ ] 2.1 `WINDOWS.md`/`WINDOWS.es.md`: rewrite Backups as automatic; state SYSTEM holds R2 creds + DSN; document one-time Sentry project/DSN and `wrangler r2 bucket lifecycle add <BUCKET> backups-30d backups/ --expire-days 30`; `install-service` re-run note (CREATEDB grant + task registration); reading the monitor.
- [ ] 2.2 Diff check: compare code-block lines of both files (excluding `#` comments) — must be empty; record the diff.
- [ ] 2.3 `STANDALONE.md`: macOS parity note. `env.example`: add `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `BACKUP_TIMEZONE`.

## Phase 3: Sentry App (WU3, PR3)

- [x] 3.1 `npm install @sentry/nextjs@11` (pin exact major).
- [x] 3.2 RED `src/instrumentation.test.ts`: mocked SDK — `init` runs before `registerNodeWorkers` (`invocationCallOrder`); no DSN → no `init`; bootstrap throw is captured and rethrown.
- [x] 3.3 GREEN `src/instrumentation.ts`: DSN guard, `Sentry.init` as first statement of the `nodejs` branch, `registerNodeWorkers()` in `try/catch`, `export const onRequestError`.
- [x] 3.4 `src/instrumentation-client.ts`: same guard on `NEXT_PUBLIC_SENTRY_DSN`; exports `onRouterTransitionStart`; no replay/tracing.
- [x] 3.5 `next.config.ts`: `withSentryConfig(nextConfig, {sourcemaps:{disable:true}, release:{create:false, name: <git SHA>}, telemetry:false, silent:true})`, imported from the `@sentry/nextjs/config` subpath (v11 moved it off the root export). `silent`/`telemetry` are both needed: the bundler plugin warns "No auth token provided" on every build before it even reads `release.create`, and reports build telemetry by default — `silent`/`telemetry:false` are the only way to keep an intentionally token-less build quiet.
- [x] 3.6 `env.ts`: `SENTRY_DSN` optional + sensitive; `NEXT_PUBLIC_SENTRY_DSN` optional, not sensitive.
- [x] 3.7 Mutation-verify 3.2: revert the DSN guard, confirm the RED test fails by name.
- [x] 3.8 `npm run build` (Turbopack): confirm no edge-runtime warning from `withSentryConfig`.
- [ ] 3.9 Manual proof: open the app from a 2nd machine at the LAN IP, trigger a client error, confirm it reaches Sentry with no replay/trace/source-map; and force a real bootstrap throw with a DSN set (e.g. temporarily point `DATABASE_URL` at a closed port) and confirm the event arrives in Sentry before the process exits.

## Phase 4: Job Failure Wrapper (WU4, PR4, needs WU3)

- [x] 4.1 RED `src/shared/jobs/capture.test.ts`: `withJobCapture` calls `report` with `{job, jobId}` tags, then rethrows the same error unchanged.
- [x] 4.2 GREEN `src/shared/jobs/capture.ts`: `withJobCapture(job, handler, report = Sentry.captureException)`.
- [x] 4.3 Wrap the 4 `boss.work()` sites: `inventory-sync/job.ts`, `reminders/job.ts`, `catalog-storage/upload-status.ts`, `pdf-generation/worker.ts`.
- [x] 4.4 `reminders/job.test.ts`: assert the captured handler still rejects (retry/deadletter preserved). Same case added to the other three sites' own test files (none had a `register*Worker` test before this WU).
- [x] 4.5 Mutation-verify 4.1: revert the rethrow, confirm the RED test fails by name. Also mutation-verified per-site: removing `withJobCapture` at each of the 4 sites fails that site's new test by name.
- [ ] 4.6 Manual proof (pending, workshop PC): force a real job throw; Sentry event carries `job`/`jobId` tags AND pg-boss still marks the job failed/retry.

## Not Tasked (follow-ups, not built)

Local dump pruning in `%USERPROFILE%\dforce-backups`; macOS `standalone.sh` backup parity; PostHog; owner's read-only ops page.
