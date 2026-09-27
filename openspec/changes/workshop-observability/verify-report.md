```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:54e4295b6cb5840bb283dcfd6ce67707beb0d801063af355710075bcaec7fbec
verdict: fail
blockers: 1
critical_findings: 1
requirements: 5/10
scenarios: 9/15
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:8185099d2c3da5cfbac07e1ffc578891405217283d13bec1ab5b807bc3741916
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: workshop-observability
**Version**: N/A (delta specs, first revision)
**Mode**: Strict TDD

All implementation is merged to `main` (PRs #136, #137, #139, #138, #140, #141). Verification ran directly against `main` (branch `main`, clean, HEAD `54e4295`... see evidence_revision).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 26 (1.1-1.7, 2.1-2.3, 3.1-3.9, 4.1-4.6) |
| Tasks complete | 26 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
$ npx tsc --noEmit
(no output, exit 0)
```

**Tests**: ✅ 1758 passed / 0 failed / 0 skipped
```text
$ npm test
 Test Files  128 passed (128)
      Tests  1758 passed (1758)
 (exit 0)
```

**Lint**: ✅ 0 errors / 14 warnings (matches the documented AGENTS.md baseline exactly — verified none of this change's files appear in the warning list; all 14 are pre-existing in unrelated files)

**Coverage**: ➖ Not available (no coverage tool configured in this repo)

### Spec Compliance Matrix

**database-backup** (6 requirements, 11 scenarios)

| Requirement | Scenario | Test / Evidence | Result |
|---|---|---|---|
| Backup Verification Pipeline Order | Full pipeline succeeds | Manual proof task 1.7(a), real Windows 11 PC: exit 0, dump+log in R2, `ok` check-in, `LastTaskResult` 0 | ✅ COMPLIANT |
| Backup Verification Pipeline Order | Corrupt dump never uploads | **None.** Task 1.7 explicitly states this path was NOT exercised ("there is no way to inject one without changing the script; covered by reading only"). Code (`Test-DumpRestorable`, `standalone.ps1:796-838`) correctly renames to `.corrupt` and never uploads on `pg_restore -l`/restore failure, but no automated or manual run ever took this branch | ❌ **UNTESTED (CRITICAL)** |
| Backup Verification Pipeline Order | in_progress sent before dump starts | Code order (`standalone.ps1:880-883`: `Send-CheckIn 'in_progress'` before `New-Dump`) + manual proof 1.7(a) happy-path sequence | ✅ COMPLIANT |
| Scratch Restore Safety | Scratch database dropped after failure | `dropdb` runs in a `finally` block (`standalone.ps1:817-820`), confirmed by code read. Manual proof 1.7(c)/(d) exercises the *createdb-failure* branch and confirms `dforce_verify` absent afterward, but the *restore-failure* branch (same root gap as above) was never exercised | ⚠️ PARTIAL (WARNING) |
| Heartbeat via Sentry Cron Monitor | Missing DSN does not block the backup | Code: `Send-CheckIn` early-returns and logs "heartbeat omitido" when `$script:SentryDsn` is empty (`standalone.ps1:723-727`). Never exercised at runtime — 1.7(b) tested a *wrong* DSN (403), not an *unset* one | ⚠️ PARTIAL (WARNING) |
| Heartbeat via Sentry Cron Monitor | Monitor config upserted on every run | Manual proof 1.7(a)/(b): monitor `dforce-catalog-backup` created on first check-in, turned red on failure (#1187). Code sends `monitor_config` on every `Send-CheckIn` call unconditionally | ✅ COMPLIANT |
| Scheduled Task Registration | Re-running install-service is idempotent | Code: `Register-ScheduledTask ... -Force` (`standalone.ps1:1027-1053`). No documented double-run proof | ⚠️ PARTIAL (WARNING) |
| Scheduled Task Registration | uninstall-service removes the task | #1187: "uninstall-service needs admin (expected)" confirms the elevation prompt only, not post-removal absence | ⚠️ PARTIAL (WARNING) |
| Off-Site Upload Under a Retention-Ready Prefix | Successful upload lands under the prefix | Automated: `upload-backup.test.mjs` (`buildUploads` returns `backups/<dump>` + `backups/<base>.service.log`), mutation-verified (task 1.6). Manual proof 1.7(a): real R2 objects uploaded | ✅ COMPLIANT |
| Off-Site Upload Under a Retention-Ready Prefix | Missing R2 credentials still alerts | Code: `standalone.ps1:902-907` Fails immediately when any `R2_*` is unset. Only a *wrong-value* R2 secret was exercised at runtime (1.7(b)), producing the same `error` check-in outcome via a different branch (upload failure, not the pre-flight unset-var check) | ⚠️ PARTIAL (WARNING) |
| Documentation Stays Command-Identical | EN/ES docs match on commands | Task 2.2: automated diff of code-block lines, empty except 2 pre-existing, out-of-scope, translated-comment mismatches present on `main` before this change | ✅ COMPLIANT |

**error-monitoring** (4 requirements, 4 scenarios)

| Requirement | Scenario | Test / Evidence | Result |
|---|---|---|---|
| Sentry Disabled Without a DSN | Empty DSNs produce no Sentry activity | `src/instrumentation.test.ts` (automated, passing in the 1758-test run) — no-DSN guard on both `instrumentation.ts` and `instrumentation-client.ts`, verified by direct code read | ✅ COMPLIANT |
| Server-Side Error Capture Ordering | Bootstrap failure is captured | `src/instrumentation.test.ts` (`invocationCallOrder`, automated) + manual proof 3.9(B): `DATABASE_URL` at closed port → ECONNREFUSED captured as DFORCE-CATALOG-4 with `handled: yes`, flush-before-exit proven on real infra (#1189) | ✅ COMPLIANT |
| Job Failure Capture and Rethrow | A job failure is reported and still fails | `capture.test.ts` (3 cases) + 4 per-site tests, all mutation-verified. Manual proof 4.6: wrong R2 secret → `pdf-generate` throws → 3 Sentry events tagged `job=pdf-generate`, same `jobId`, `handled: yes` (original + 2 pg-boss retries) | ✅ COMPLIANT |
| Browser Error Capture on Insecure LAN Context | Error on insecure LAN origin reaches Sentry | Manual proof 3.9(A): Mac browser at `http://192.168.0.15:3000` → DFORCE-CATALOG-3, release = git SHA, no user IP (#1189). No-replay/no-tracing confirmed by code absence (`instrumentation-client.ts` has no replay/tracing integration), not by a captured network trace | ✅ COMPLIANT |

**Compliance summary**: 9/15 scenarios COMPLIANT, 5 PARTIAL (WARNING — static-evidence-only, adjacent runtime evidence exists), 1 UNTESTED (CRITICAL — the genuinely-corrupt-dump path, never exercised by any means).

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|---|---|---|
| Backup Verification Pipeline Order | ✅ Implemented | `Invoke-Backup` (`standalone.ps1:841-940`) runs check-in → dump → verify → upload → check-in in the exact spec order |
| Scratch Restore Safety | ✅ Implemented | Never `-C`/`--create`; `dropdb` in `finally`; fixed `dforce_verify` name |
| Heartbeat via Sentry Cron Monitor | ✅ Implemented | `monitor_config` upsert every call; `BACKUP_TIMEZONE` default `America/Panama`; DSN-unset skip logged |
| Scheduled Task Registration | ✅ Implemented | `-Force`, SYSTEM, Daily 12:00, `StartWhenAvailable`/`RunOnlyIfNetworkAvailable` |
| Off-Site Upload Under a Retention-Ready Prefix | ✅ Implemented | `region:"auto"`, `requestChecksumCalculation`/`responseChecksumValidation:"WHEN_REQUIRED"`, `backups/` prefix, no delete code anywhere in the diff |
| Documentation Stays Command-Identical | ✅ Implemented | `WINDOWS.md`/`WINDOWS.es.md` verified identical on commands |
| Sentry Disabled Without a DSN | ✅ Implemented | Explicit DSN guard, both server and client |
| Server-Side Error Capture Ordering | ✅ Implemented | `Sentry.init` is the first statement of the `nodejs` branch; `onRequestError` exported |
| Job Failure Capture and Rethrow | ✅ Implemented | `withJobCapture` wraps all 4 `boss.work()` sites; rethrows the same error object |
| Browser Error Capture on Insecure LAN Context | ✅ Implemented | `instrumentation-client.ts` guards on `NEXT_PUBLIC_SENTRY_DSN`; no replay/tracing configured |

### Coherence (Design)
| Decision | Followed? | Notes |
|---|---|---|
| D13 — no `sentry.edge.config.ts`/`sentry.server.config.ts` | ✅ Yes | Confirmed absent; init lives inline in `instrumentation.ts`/`instrumentation-client.ts` as decided |
| D16 — `release.create:false`, `release.name` = git SHA | ✅ Yes | `next.config.ts:82-92` matches exactly, including the `SENTRY_RELEASE` env override |
| D17 — `NEXT_PUBLIC_SENTRY_DSN` not sensitive | ✅ Yes | `env.ts`: only `SENTRY_DSN` is in `SENSITIVE_ENV_KEYS` |
| Decision 9 — `BACKUP_TIMEZONE` default, `checkin_margin`/`max_runtime` in minutes | ✅ Yes | `Send-CheckIn` matches exactly (180/30) |
| Decision 18 — `withJobCapture` interface | ✅ Yes | Matches the Interfaces section signature exactly (the `?? "unknown"` fallback is a documented, in-scope addition for the empty-array edge case) |

### Issues Found

**CRITICAL**:
1. **`database-backup` "Corrupt dump never uploads" scenario has zero runtime evidence** — neither an automated test (no Pester harness exists for this repo, by design) nor the manual proof exercised the `pg_restore -l`/scratch-restore-failure → `.corrupt` rename path. This is a pre-existing, explicitly disclosed gap (task 1.7's own text: "there is no way to inject one without changing the script"), not a newly discovered defect — static code read shows the branch (`standalone.ps1:796-838`) correctly renames the dump, drops `dforce_verify` in `finally`, sends the `error` check-in, and never uploads. Recommend the owner either (a) explicitly accept this residual risk as documented policy before archive, converting it from an open gap to a recorded decision, or (b) add a minimal fault-injection harness (e.g. truncate a real dump file and run `Test-DumpRestorable` against it directly) before archive.

**WARNING**:
1. Four backup-script branches have code-only verification, no runtime proof: scratch-restore-failure cleanup specifically (the restore-failure half of decision 4.1's dropdb-in-finally, same root cause as the CRITICAL item above), `install-service` re-run idempotency, `uninstall-service` post-removal task absence, and the exact "R2_* variable unset" pre-flight branch (only a wrong-value R2 secret was exercised, which takes a different code path to the same alerting outcome). All five are simple, low-complexity branches (early returns, standard `-Force`/`Register-ScheduledTask` API idioms) and the project's own design.md Testing Strategy table already scopes WU1's PowerShell code to "PowerShell (no Pester): smoke test on the PC" rather than exhaustive per-branch automated coverage — so this is consistent with the accepted testing strategy, not a regression.
2. `proposal.md`'s Success Criteria checklist (4 items) and `design.md`'s Open Questions (2 items) remain unchecked `[ ]` even though the underlying decisions were resolved during apply (the check-in message-field question was decided as-is in design decision 2; local-dump pruning was deliberately deferred and is recorded in `tasks.md`'s "Not Tasked" section). Cosmetic drift only — no behavioral contradiction — but should be reconciled before archive so the archived artifact doesn't read as having open decisions that are, in fact, closed.
3. Manual proof 3.9(A) (browser error on insecure LAN) confirms the error reached Sentry but does not record an explicit network-trace check that no replay/tracing/source-map calls were made — the "no replay/tracing" half of that scenario rests on static code absence (no replay integration configured) rather than an observed absence of network calls.

**SUGGESTION**: None beyond the WARNING items above.

### Drift Check (proposal/spec/design vs. shipped code)

No contradictions found. Every specific item called out for drift-checking matches the shipped code exactly:
- No `sentry.edge.config.ts`/`sentry.server.config.ts` — confirmed absent (design decision 13, a documented deviation from `exploration.md`'s external-facts suggestion, not an undocumented drift).
- `NEXT_PUBLIC_SENTRY_DSN` not sensitive — confirmed in `env.ts`.
- Release name from git SHA — confirmed in `next.config.ts`'s `getReleaseName()`.
- Log target `$BackupDir\service.log` — confirmed in `Invoke-Backup`.
- `BACKUP_TIMEZONE` default `America/Panama` — confirmed in `Send-CheckIn`.
- The `service.log` unbounded-growth/R2-duplication question `tasks.md` left open for WU2 to decide was in fact resolved: `WINDOWS.md`'s "`service.log` is cumulative" section documents the behavior as-is (chose not to truncate/rotate), matching the WU2 apply-progress note.

The only artifact-vs-code gaps found are the stale checklists noted under WARNING #2 above — cosmetic, not substantive.

### Follow-ups Deliberately Not Built (from tasks.md "Not Tasked" + Engram merge-status)

- Local dump pruning in `%USERPROFILE%\dforce-backups` (dumps accumulate forever; documented, deliberately deferred).
- macOS `standalone.sh` backup parity (Windows-only backup pipeline; `STANDALONE.md` carries a parity note).
- PostHog (parked per the exploration's owner-approved scope).
- Owner's read-only multi-project ops page (separate future change).
- Node stdout OEM-decoding fix applied only to the backup path's node call (`Invoke-Backup`); the same class of issue in `db:migrate`/`seed-user` Node calls is an open follow-up per #1187.
- The pre-existing `next start` vs `output: "standalone"` mismatch on the Windows service path (#1189) — pre-existing, unrelated to this change's scope, the Docker path is unaffected.
- Owner still needs to restore `R2_SECRET_ACCESS_KEY` on the test PC (#1188) — an operational task, not a code gap.

### Verdict
**FAIL** — one spec scenario (`database-backup` "Corrupt dump never uploads") has zero runtime evidence by any means, which the skill's decision gate classifies as CRITICAL/UNTESTED regardless of how well-documented and low-probability the gap is. Every other dimension is clean: all 26 tasks complete, 1758/1758 tests passing, `tsc` clean, lint at the exact documented baseline, and 9 of the remaining 14 spec scenarios have real runtime proof (5 automated-only via unit test, 4 via manual proof on real Windows/Sentry infrastructure, several via both). This is a disclosed, pre-existing risk acknowledged during apply — not a newly discovered defect — and the recommended next step is an owner decision (accept the residual risk explicitly, or add a minimal fault-injection check) rather than further coding work.
