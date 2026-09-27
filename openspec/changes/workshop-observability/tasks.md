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

**Measured vs forecast** (after the gate's corrective re-run): code changes
total ~424 lines (`standalone.ps1` +286/-18, `upload-backup.mjs` 82 new lines,
`upload-backup.test.mjs` 38 new lines), above the ~300 forecast and the
400-line attempt cap. The overage is real new surface (Tls12, `-NodeDir`,
`New-Dump` extraction, `Write-BackupLog`, `Send-CheckIn`,
`Send-BackupFailureEvent`, `Test-DumpRestorable`, the `Invoke-Backup`
rewrite, `Grant-BackupCreatedb`, `Register-BackupTask`, plus the
uninstall/status hooks), not scope creep — every line maps to 1.1–1.5 below.
**`size:exception` granted by the owner (2026-09-26)**: a fresh-context
validator confirmed no safe fat remained after trimming, and the only split
that works (upload script first, `.ps1` second) would merge a script nothing
calls. PR1 declares the exception.

- [x] 1.1 RED `scripts/upload-backup.test.mjs`: `buildUploads` returns `backups/<dump>` + `backups/<base>.service.log` keys; log omitted → dump only.
- [x] 1.2 GREEN `scripts/upload-backup.mjs`: pure `buildUploads` + `S3Client{region:"auto", requestChecksumCalculation/responseChecksumValidation:"WHEN_REQUIRED"}`; `main()` guarded by `fileURLToPath(import.meta.url)===path.resolve(process.argv[1])`.
- [x] 1.3 `standalone.ps1`: Tls12 line; `New-Dump`; verify pipeline (`pg_restore -l` → `dforce_verify` createdb/restore/dropdb in `finally`); `Send-CheckIn` (`in_progress`/`ok`/`error`, `monitor_config` upsert, `BACKUP_TIMEZONE` default `America/Panama`); `Fail` hook (log + error check-in + Sentry event naming the step, `exit 1`).
- [x] 1.4 `Register-BackupTask` in `Install-BootTask` (idempotent, SYSTEM, Daily 12:00, `StartWhenAvailable`/`RunOnlyIfNetworkAvailable`); remove in `uninstall-service`; `LastTaskResult` in `status`.
- [x] 1.5 `install-service`: grant `ALTER ROLE "dforce" CREATEDB` via superuser `Invoke-Psql`.
- [x] 1.6 Mutation-verify 1.1: revert `buildUploads`, confirm the RED test fails by name.
- [ ] 1.7 Manual proof (not unit-testable, pending on the workshop PC), must show all three: (a) `standalone.ps1` parses and runs under real PowerShell 5.1, dump+log land in R2, `ok` check-in; (b) a deliberately corrupted dump copy produces BOTH the `error` check-in AND the Sentry event naming the step; (c) `dforce_verify` is absent afterward in both the success and corrupted-dump runs. `pwsh` is unavailable on this machine (macOS, no PowerShell installed) so no local parse check ran either — only a brace/paren balance heuristic.

## Phase 2: Backup Docs (WU2, PR2)

- [ ] 2.1 `WINDOWS.md`/`WINDOWS.es.md`: rewrite Backups as automatic; state SYSTEM holds R2 creds + DSN; document one-time Sentry project/DSN and `wrangler r2 bucket lifecycle add <BUCKET> backups-30d backups/ --expire-days 30`; `install-service` re-run note (CREATEDB grant + task registration); reading the monitor.
- [ ] 2.2 Diff check: compare code-block lines of both files (excluding `#` comments) — must be empty; record the diff.
- [ ] 2.3 `STANDALONE.md`: macOS parity note. `env.example`: add `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `BACKUP_TIMEZONE`.

## Phase 3: Sentry App (WU3, PR3)

- [ ] 3.1 `npm install @sentry/nextjs@11` (pin exact major).
- [ ] 3.2 RED `src/instrumentation.test.ts`: mocked SDK — `init` runs before `registerNodeWorkers` (`invocationCallOrder`); no DSN → no `init`; bootstrap throw is captured and rethrown.
- [ ] 3.3 GREEN `src/instrumentation.ts`: DSN guard, `Sentry.init` as first statement of the `nodejs` branch, `registerNodeWorkers()` in `try/catch`, `export const onRequestError`.
- [ ] 3.4 `src/instrumentation-client.ts`: same guard on `NEXT_PUBLIC_SENTRY_DSN`; exports `onRouterTransitionStart`; no replay/tracing.
- [ ] 3.5 `next.config.ts`: `withSentryConfig(nextConfig, {sourcemaps:{disable:true}, release:{create:false}, telemetry:false, silent:true})`.
- [ ] 3.6 `env.ts`: `SENTRY_DSN` optional + sensitive; `NEXT_PUBLIC_SENTRY_DSN` optional, not sensitive.
- [ ] 3.7 Mutation-verify 3.2: revert the DSN guard, confirm the RED test fails by name.
- [ ] 3.8 `npm run build` (Turbopack): confirm no edge-runtime warning from `withSentryConfig`.
- [ ] 3.9 Manual proof: open the app from a 2nd machine at the LAN IP, trigger a client error, confirm it reaches Sentry with no replay/trace/source-map.

## Phase 4: Job Failure Wrapper (WU4, PR4, needs WU3)

- [ ] 4.1 RED `src/shared/jobs/capture.test.ts`: `withJobCapture` calls `report` with `{job, jobId}` tags, then rethrows the same error unchanged.
- [ ] 4.2 GREEN `src/shared/jobs/capture.ts`: `withJobCapture(job, handler, report = Sentry.captureException)`.
- [ ] 4.3 Wrap the 4 `boss.work()` sites: `inventory-sync/job.ts`, `reminders/job.ts`, `catalog-storage/upload-status.ts`, `pdf-generation/worker.ts`.
- [ ] 4.4 `reminders/job.test.ts`: assert the captured handler still rejects (retry/deadletter preserved).
- [ ] 4.5 Mutation-verify 4.1: revert the rethrow, confirm the RED test fails by name.
- [ ] 4.6 Manual proof: force a real job throw; Sentry event carries `job`/`jobId` tags AND pg-boss still marks the job failed/retry.

## Not Tasked (follow-ups, not built)

Local dump pruning in `%USERPROFILE%\dforce-backups`; macOS `standalone.sh` backup parity; PostHog; owner's read-only ops page.

Note for WU2 docs: `$BackupDir\service.log` is cumulative across runs and gets
uploaded WHOLE under each dump's key, so it grows without bound and each R2
copy after the first duplicates every prior run's lines — WU2 should decide
whether to document this as-is or truncate/rotate it. (GGA fix round:
`Register-BackupTask` now bakes `-PgHost`/`-PgPort`/`-DbName`/`-DbUser`/
`-DbPassword` into the task's action line whenever any of the five differs
from its script default, alongside the always-baked `-BackupDir`/`-NodeDir`
— so a non-default install no longer registers a task that fails every day.)
