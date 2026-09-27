# Proposal: Workshop Observability

## Intent

The workshop PC has no automatic backup: the nightly task is a manual snippet in `WINDOWS.md`, nothing leaves the disk, nobody sees app or job errors, and a silently failing backup would go unnoticed. The owner must be able to confirm, from outside the workshop, that data is safe and the app is healthy.

## Scope

### In Scope
- **Backup pipeline**: `install-service` registers `DforceCatalogoBackup` (daily 12:00, SYSTEM, `StartWhenAvailable`, `RunOnlyIfNetworkAvailable`). `standalone.ps1 backup` runs `pg_dump` → `pg_restore -l` pre-check → scratch restore (`createdb`/`pg_restore --exit-on-error --no-owner`/`dropdb`) → upload dump + `service.log` to R2 via new `scripts/upload-backup.mjs` → Sentry cron check-in (`in_progress`, then `ok`/`error`, `monitor_config` upsert).
- **Sentry app errors** (`@sentry/nextjs@11`): server in `instrumentation.ts` (Sentry import first, then pg-boss bootstrap; `onRequestError`), edge config, browser via `instrumentation-client.ts`, `withSentryConfig` with `sourcemaps.disable`. Errors only.
- **Job failures**: capture-and-rethrow wrapper at the 4 `boss.work()` sites.
- **Docs**: `WINDOWS.md` + `WINDOWS.es.md` together, `STANDALONE.md` parity note, `env.example`.

### Out of Scope
- PostHog; the owner's multi-project ops page.
- Retention code — an R2 lifecycle rule (one-time `wrangler` step) instead.
- macOS script changes; Sentry replay, tracing, source-map upload.
- Any UI change — so "every mutation tells the operator" does not apply.

## Capabilities

### New Capabilities
- `database-backup`: scheduled dump, restore verification, off-site upload, heartbeat.
- `error-monitoring`: server, browser and job-failure error reporting.

### Modified Capabilities
None.

## Approach

Follow the exploration's approaches 1–5: plain `.mjs` (like `migrate.mjs`), `Get-EnvValue` for SYSTEM env, DSN-derived cron URL over `Invoke-RestMethod`, injected-deps wrapper for testability. `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` sensitive in `env.ts`.

## Affected Areas

| Area | Impact |
|------|--------|
| `scripts/windows/standalone.ps1` | Modified |
| `scripts/upload-backup.mjs` | New |
| `src/instrumentation*.ts`, `sentry.*.config.ts`, `next.config.ts`, `package.json` | New/Modified |
| `src/shared/config/env.ts` | Modified |
| 4 worker files + `shared/jobs` | Modified |
| `WINDOWS*.md`, `STANDALONE.md`, `env.example` | Modified |

## Risks

| Risk | Mitigation |
|------|------------|
| SYSTEM holds R2 write creds + DSN | Same trust as boot task; stated in docs |
| R2 rejects SDK CRC32 | `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"` |
| PS 5.1 TLS failure | `Tls12` one-liner at script top |
| Scratch restore touches production DB | Never `pg_restore -C`; fixed `dforce_verify` name |
| Upload script untestable by precedent | Real-bucket smoke test is the verification; docs say so |
| Browser SDK on insecure LAN | Verify from a second machine at the LAN IP |

## Delivery

Four disjoint work units, docs travelling with their unit: (1) backup pipeline + upload script, (2) Sentry server/client/config, (3) job wrapper, (4) remaining docs. Stacked PRs to `main` if the tasks forecast exceeds 400 lines.

## Rollback Plan

Revert per PR. On the PC: `Unregister-ScheduledTask DforceCatalogoBackup`; an empty `SENTRY_DSN` disables the SDK.

## Success Criteria

- [ ] A dump and a log appear in R2 daily.
- [ ] A missed day produces a Sentry cron alert.
- [ ] An app or job error appears in Sentry with a stack trace.
- [ ] A corrupt dump yields an `error` check-in, never a silent upload.
