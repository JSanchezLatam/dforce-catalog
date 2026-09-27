# Exploration — workshop-observability

Backup to R2, Sentry, heartbeat and restore verification for the workshop PC.
Explored 2026-09-26 by two parallel agents (codebase + external docs) and gated
by the orchestrator; corrections from the gate are marked **[gate]**.
Engram: `sdd/workshop-observability/explore` (#1163) and
`sdd/workshop-observability/explore-research` (#1164).

## Scope (owner-approved, see Engram `infra/workshop-ops-decisions`)

1. Daily backup uploaded to R2, retention by lifecycle rule.
2. Sentry for the Next.js app (server, and client — see decision D1).
3. Heartbeat so a MISSING daily backup alerts the owner.
4. Automatic verification that each dump is restorable.

Out of scope: PostHog (parked), the owner's read-only multi-project ops page
(separate later change), any macOS script change beyond noting parity.

## Current state

**Backup.** `scripts/windows/standalone.ps1` `Invoke-Backup` runs `pg_dump -Fc`
into `%USERPROFILE%\dforce-backups`, checks the file is non-empty, and stops.
`Install-BootTask` registers exactly one Task Scheduler task (`DforceCatalogo`,
AtStartup, SYSTEM). The nightly `DforceCatalogoBackup` task exists only as a
manual snippet in `WINDOWS.md`; nothing in code registers it, so in practice
there is no automatic backup and nothing ever leaves the disk. The macOS twin
(`scripts/macos/standalone.sh` + `STANDALONE.md`'s `crontab -e` line) has the
same gap — a parity note, not scope.

**R2.** `src/modules/catalog-storage/r2.ts` is the only importer of
`@aws-sdk/client-s3`; it uses the `@/` alias and Next's module graph, so a plain
Node script cannot import it. `scripts/migrate.mjs` and `scripts/seed-user.mjs`
set the convention: plain `.mjs` under `scripts/`, no alias, no TS runner
(`seed-user.mjs`'s header states the reasoning). Env `R2_*` keys are `optional()`
in `src/shared/config/env.ts` and already classified as sensitive.

**SYSTEM and `.env`.** Already solved once: `Get-EnvValue` in `standalone.ps1`
and `service-start.ps1` parses `.env` line by line (UTF-8, no BOM) because the
SYSTEM task cannot see the interactive user's environment. The same helper
hands `R2_*` and a Sentry DSN to the backup task with no new plumbing.

**Sentry hook point.** `src/instrumentation.ts` `register()` does one thing on
`NEXT_RUNTIME === "nodejs"`: dynamic-import `instrumentation-node.ts`, whose
`registerNodeWorkers()` starts, in order, `registerInventorySyncWorker`,
`scheduleWeeklySync`, `registerPdfGenerateWorker`, `registerPdfUploadWorker`,
`registerReminderWorker`. `@sentry/nextjs` is not a dependency today.

**Errors nobody sees today** (grep, non-test `src`): `shared/jobs/boss.ts:27`
(pg-boss connection errors), `inventory-sync/mapper.ts:79,82,85` (malformed
fields, warn-and-continue), `pdf-generation/worker.ts:263`,
`app/api/customer-import/route.ts:46`, `catalog-storage/retention.ts:90`.

**pg-boss job failures.** `boss.work()` is called at **4 sites [gate]**:
`inventory-sync/job.ts:188`, `reminders/job.ts:312`,
`catalog-storage/upload-status.ts:104`, `pdf-generation/worker.ts:285`.
(`customer-import/job.ts` runs inline from the API route, not as a worker.)
Each hands pg-boss a bare async callback. pg-boss's `Events` type is
`error | warning | wip | stopped | bam | flow` — **no per-job "failed" event**
(verified in `node_modules/pg-boss/dist/types.d.ts`), so a failed job is only
visible by querying `pgboss.job`. Capture has to wrap each call site; the
`register*Worker({ getBoss })` injected-deps shape (`reminders/job.test.ts`)
makes that wrapper unit-testable.

**Restore.** `Invoke-Restore` runs `pg_restore --clean --if-exists --no-owner`
and confirms by table count, after a safety backup. `pg_restore -l` appears only
inside a manual troubleshooting message (`standalone.ps1:744`).

**Tests.** Two Vitest projects; `DATABASE_URL` points at a placeholder, so real
SQL never runs (AGENTS.md's injected-seam limit). `scripts/*.mjs` have no tests
today; a mocked-S3 unit test for the upload script is possible but has no
precedent.

## External facts (verified against official docs, 2026-09-26)

- `@sentry/nextjs@11` peer-depends on `next ^16` → Next 16.2 is supported.
  Manual setup: `instrumentation-client.ts` (client init +
  `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`),
  `sentry.server.config.ts`, `sentry.edge.config.ts`, and in
  `instrumentation.ts`: `await import("./sentry.server.config")` as the FIRST
  statement of the existing `nodejs` branch, then the pg-boss bootstrap; plus
  `export const onRequestError = Sentry.captureRequestError`. Keep
  `withSentryConfig(nextConfig, { org, project, sourcemaps: { disable: true } })`
  with no auth token; no wizard. Turbopack is supported.
- Insecure context (`http://192.168.x.x`): Sentry's `uuid4()` tries
  `crypto.randomUUID` in a try/catch and falls back to `Math.random`; transport
  is `fetch` to an HTTPS ingest host (not mixed content). Safe on the LAN; still
  verify from a second machine per AGENTS.md's third testing limit.
- Sentry Cron Monitors over plain HTTP, no SDK:
  `https://o<orgId>.ingest.sentry.io/api/<project_id>/cron/<slug>/<public_key>/`
  (all three values come from the DSN). GET `?status=in_progress|ok|error`, or
  POST JSON with `monitor_config` upsert (`schedule` crontab, `checkin_margin`,
  `max_runtime`, `timezone`). Every Sentry plan includes ONE cron monitor free
  — exactly this job. healthchecks.io is the fallback if more are ever needed.
- R2 lifecycle rules: expire by days, prefix-scoped, set once via dashboard or
  `wrangler r2 bucket lifecycle add <BUCKET> <NAME> backups/ --expire-days 30`.
  Free tier 10 GB-month / 1M Class A / 10M Class B; a daily dump under 50 MB
  with 30-day retention stays far inside it. `PutObject` with a read stream is
  enough at this size. **Checksum quirk**: `@aws-sdk/client-s3` ≥ 3.729 sends
  CRC32 by default and R2 has rejected it; this repo is on `^3.1092`. Safe
  switch on `S3Client`: `requestChecksumCalculation: "WHEN_REQUIRED"`,
  `responseChecksumValidation: "WHEN_REQUIRED"`.
- `pg_restore -l` reads ONLY the table of contents: a truncated dump lists fine
  and dies on the real restore. The meaningful check is a scratch restore:
  `createdb dforce_verify && pg_restore -d dforce_verify --exit-on-error
  --no-owner <file> && dropdb dforce_verify`. Never `-C`: the archive carries
  the production database name. Postgres is local and the data is small, so
  this costs seconds.
- Windows PowerShell 5.1 as SYSTEM: set
  `[Net.ServicePointManager]::SecurityProtocol -bor Tls12` at the top of the
  script before `Invoke-RestMethod`; SYSTEM has outbound network and ignores
  the per-user proxy (fine on a plain router LAN). Daily trigger plus
  `New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable`
  so a PC that was off at the scheduled time runs it after boot; Sentry's
  `checkin_margin` catches the day it never does.

## Approaches

1. **Upload via a plain-Node `scripts/upload-backup.mjs`** called from
   `Invoke-Backup`, hand-rolling ~10 lines of `S3Client`/`PutObjectCommand`
   against `process.env.R2_*`. Matches `migrate.mjs`/`seed-user.mjs`. Rejected
   alternative: `tsx` to import `r2.ts` — a new dependency for one script.
2. **Sentry init in `instrumentation.ts`**, Sentry import first so a failure in
   the worker bootstrap is itself captured; `onRequestError` exported beside
   `register()`. Client init in `instrumentation-client.ts` (decision D1).
3. **Per-call-site job wrapper** at the 4 `boss.work()` sites: captures and
   rethrows, so pg-boss retry/deadletter behaviour is untouched. Four disjoint
   files — a clean parallel-subagent split.
4. **Restore verification as a scratch restore** after every dump
   **[gate: supersedes the codebase agent's `-l`-only recommendation]**, with
   `pg_restore -l` kept only as a fast pre-check before upload. Exit code drives
   the heartbeat status (`ok`/`error`).
5. **Heartbeat**: one `Invoke-RestMethod` POST with `monitor_config` upsert at
   the start of `Invoke-Backup` (`in_progress`) and one at the end
   (`ok`/`error`), reusing the DSN for org/project/key.

## Decisions (owner, 2026-09-26)

- **D1 — client-side Sentry: YES.** Server and browser. The SDK is safe on the
  LAN's insecure context; operators hit the UI from tablets and their errors are
  exactly what the owner cannot see today. `instrumentation-client.ts`, errors
  only — no replay, no tracing.
- **D2 — restore verification: automatic scratch restore after every dump.**
  `createdb` + `pg_restore --exit-on-error --no-owner` + `dropdb`; `pg_restore
  -l` stays only as a fast pre-check. The manual drill is not needed.
- **D3 — DSN classification: sensitive.** Not a secret by Sentry's model, but
  this repo's bar (`IFX_TOKEN`, `R2_*`) is conservative and it costs nothing.
- **D4 — backup time: 12:00 local**, the PC is certainly on and online at
  midday; `StartWhenAvailable` covers a late boot.

## Affected areas

- `scripts/windows/standalone.ps1` — `Invoke-Backup` gains verify + upload +
  heartbeat; `Install-BootTask` registers `DforceCatalogoBackup`.
- `scripts/upload-backup.mjs` (new).
- `src/instrumentation.ts`, `src/instrumentation-node.ts`,
  `src/instrumentation-client.ts` (new), `sentry.server.config.ts`,
  `sentry.edge.config.ts` (new), `next.config.ts`, `package.json`.
- `src/shared/config/env.ts` — `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`.
- `src/shared/jobs/boss.ts` + the 4 worker files.
- `WINDOWS.md` + `WINDOWS.es.md` together (convention 2026-09-26);
  `STANDALONE.md` parity note; `.env.example`.

## Risks

- SYSTEM now holds R2 write credentials and a DSN — same trust the boot task
  already has; restate it in `WINDOWS.md` rather than imply it.
- R2 retention is a lifecycle rule, not code — say so in tasks so nobody
  invents a deletion path.
- Upload script has no unit-test precedent; smoke-test against the real bucket
  is the verification, and the docs must say so (AGENTS.md coverage-limit
  pattern).
- Four work units (backup pipeline; Sentry server+client; job wrapper; docs) —
  likely over 400 lines together. Stacked PRs to `main` per `chained-pr`, since
  each unit lands independently.

## Ready for proposal

Yes.
