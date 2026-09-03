# Archive Report: Service History per Vehicle (C4)

**Change**: `service-history-per-vehicle`
**Archived to**: `openspec/changes/archive/2026-09-03-service-history-per-vehicle/`
**Archive Date**: 2026-09-03
**Merged to**: `main` @ `1d02041`, via tracker PR #56 and child PRs #57–#62 (51 commits, 49 files, +5012/−90)

## Execution Summary

`service-history-per-vehicle` is fully archived. Every `orden_servicio` now
binds to exactly one `vehiculo` (FK, `NOT NULL`, `ON DELETE RESTRICT`), a
5-value `categoria` enum classifies each order (REVISADO included as a peer
service type, not a status), three completion-time note fields
(hallazgos/recomendaciones/observaciones) are patchable post-creation, and a
new `/customers/[id]/vehicles/[vehicleId]` screen shows a vehicle's own
service history.

- **Delta specs merged into**: `openspec/specs/customer-management/spec.md`,
  `openspec/specs/service-orders/spec.md`
- **Change folder moved**: `openspec/changes/service-history-per-vehicle/` →
  `openspec/changes/archive/2026-09-03-service-history-per-vehicle/`
- **SDD cycle**: Proposal → Spec → Design → Tasks → Applied (7 PRs) →
  Verified (PASS WITH WARNINGS) → Archived

## Final-State Authority — why this report overrides the snapshot artifacts

`apply-progress` and the first `verify-report` pass were written mid-cycle
and are now stale on their own "pending"/"FAIL" language. This report ranks
sources per the archive skill's Final-State Authority hierarchy:

1. **Native review authority**: absent. `reviewGate` was never populated for
   this candidate — receipt-driven development (the opt-in kill switch) was
   not engaged; delivery went through GGA per PR instead (see below), not the
   native RDD receipt path. This is "kill switch off" / "no review started,"
   which proceeds under ordinary repository policy with no gate to satisfy.
2. **Persisted tasks artifact** (`tasks.md`, now at
   `archive/2026-09-03-service-history-per-vehicle/tasks.md`): 41 checked /
   49 total. The 8 unchecked boxes are a deliberate deferral register (each
   one explicitly labelled "Follow-up," raised during a GGA round, and
   scoped out on purpose) — not incomplete implementation work. See Task
   Completion Gate below.
3. **Explicit final-state facts in the launch prompt** (outranks the
   snapshots below): C4 is merged to `main` @ `1d02041` via 7 PRs; the gate
   on the merged result is 1069 tests / 79 files, `tsc --noEmit` clean,
   `npm run lint` 0 errors / 15 warnings, e2e 31/31 against throwaway
   `dforce_c4_e2e`; GGA passed/converged on all 6 PRs (#57–#62).
4. **verify-report** (lowest rank, but not contradicted by anything higher):
   the FIRST verify pass (Engram #877/#878, evidence_revision
   `sha256:a58f1e94...`) returned **FAIL** — 7/30 spec scenarios (all
   `page.tsx` rendering) had zero runtime-executed covering test, a
   structural gap in this repo's page-test convention, not a functional
   defect. Task 3.16 added 3 new `page.test.tsx` files (9 tests, 216 lines,
   zero non-test lines) closing that gap. The RE-VERIFY pass persisted at
   `sdd/service-history-per-vehicle/verify-report` (Engram #876,
   evidence_revision `sha256:7bab2774...`) is the version actually on disk
   at `verify-report.md` in the archived folder — **PASS WITH WARNINGS**,
   30/30 scenarios covered, independently re-run: `tsc` 0 errors, 79
   files/1069 tests green. No contradiction to record: the FAIL was real at
   its time and was fixed in a later commit (task 3.16), and the file on
   disk already reflects the fix — nothing here needed correcting.

**No unrankable contradictions found.** The launch prompt's final-state
facts (merge commit, PR count, gate numbers, GGA rounds) are consistent with
what the RE-VERIFY report and the repository history show.

## Task Completion Gate

**Status**: PASSED (via the deferral-register exception, not a violation)

41/49 checkboxes are `[x]`. The 8 remaining `[ ]` are, verbatim from
`tasks.md`: 1.18, 1.19, 2.11, 2.12, 3.10, 3.11, 3.13, 3.15 — each one prefixed
"Follow-up" in its own text, each naming the exact GGA round that raised it,
and each explaining why it was deliberately left unfixed (scope discipline,
"revisit if reported," "trim the next time this file is opened," etc.). This
matches the precedent already recorded in this same `archive/README.md` for
`crm-shell-settings-rbac`'s "Deferred to follow-up change" register: unchecked
boxes that are a known, written deferral are not the stale/incomplete-work
case the Task Completion Gate exists to catch. No reconciliation of the
checkboxes themselves was performed or needed — they stay unchecked in the
archived file, exactly as `sdd-apply` and `sdd-verify` left them.

## Where the C4 delta AGREED with shipped code (verified, not assumed)

Per this archive's explicit instruction, every delta claim below was checked
against `src/` directly rather than trusted from the delta text, because a
consolidated spec asserting the opposite of shipped code is this project's
recurring failure mode (it happened with the `vehicles-one-to-many` archive,
see `bd56873`). Findings:

| Delta claim | Code checked | Result |
|---|---|---|
| `orden_servicio.vehiculoId` NOT NULL, FK to `vehiculo`, `ON DELETE RESTRICT` | `src/shared/db/schema.ts:351–353` | MATCHES |
| `categoria` enum has exactly 5 unaccented Spanish slugs, no default | `src/shared/db/schema.ts:232–239, 357` | MATCHES |
| `hallazgos`/`recomendaciones`/`observaciones` are nullable text, set only via patch | `src/shared/db/schema.ts:362–364`; `src/app/api/service-orders/[id]/route.ts:17,59–79` | MATCHES |
| `createOrder` rejects unknown/cross-customer vehicle with Spanish error | `src/modules/service-orders/service.ts:93–108,195–201` | MATCHES |
| SEAM at `vehicles.ts` blocks permanent deletion of a vehicle with `orden_servicio` history, inside the same tx, `ClienteValidationError` under `vehicles` key | `src/modules/customers/vehicles.ts:269–298` | MATCHES |
| Deactivate-only plans do not run the SEAM's `select` (soft delete stays allowed with history) | `src/modules/customers/vehicles.ts:269` (`if (plan.delete.length > 0)`, deactivate handled above, unconditionally) | MATCHES |

**No disagreement found between the C4 delta text and the shipped code.**
The delta specs were merged into the main specs verbatim (with only the
expected MODIFIED-requirement replacement and ADDED-requirement appends —
see below), because the verification above confirms the delta already
describes the shipped behavior correctly. This is a different outcome from
the `vehicles-one-to-many` archive, where the merged-but-unarchived spec had
drifted from a since-changed migration; here the drift check came back
clean.

## Specs Consolidated into Main Source of Truth

### customer-management

**Action**: MODIFIED existing `openspec/specs/customer-management/spec.md`

- **MODIFIED** "Vehicle Collection Persistence, Soft Delete, and Permanent
  Deletion" — replaced with the C4 delta's version in place: added the
  referential-integrity check for permanent deletion (refuses deletion of a
  vehicle with `orden_servicio` history, Spanish 400 under the `vehicles`
  key), added the one clarifying sentence that soft delete remains allowed
  regardless of history, replaced the old unconditional "administrador
  permanently deletes a vehicle" scenario with the history-qualified version,
  and appended the two new scenarios (reject-with-history,
  soft-delete-still-works-with-history). All 6 unrelated scenarios preserved
  verbatim.
- **ADDED** "Vehicle Detail Screen with Service History" — new requirement,
  5 scenarios, appended in full.
- **Preserved unchanged**: R16 (Cliente Creation/Editing/Listing/Detail),
  R17 (Field Validation), R18 (Duplicate Detection), R19 (List View Search).
- Intro line extended by one clause to record C4 (and C3, which the intro
  line had never mentioned even though its content was already merged) as
  consolidation sources — documentation-only, not a requirement change.

**Requirement count**: 6 total (4 unchanged, 1 modified, 1 added).

### service-orders

**Action**: MODIFIED existing `openspec/specs/service-orders/spec.md`

- **MODIFIED** "Service Order Creation with Parts (R20)" — replaced in
  place: vehicle+category now required at creation, cross-ownership check,
  zero-active-vehicles UI directive; 3 new scenarios beyond the original 4
  (unknown vehicle, cross-customer vehicle, zero-vehicle picker state).
- **ADDED** "Service Category Vocabulary" — new requirement, 2 scenarios.
- **ADDED** "Category and Completion Notes Editing" — new requirement, 3
  scenarios.
- **ADDED** "Service Order Detail Displays Vehicle, Category, and Notes" —
  new requirement, 3 scenarios.
- **Preserved unchanged**: R21 (Status Lifecycle Transitions), R22 (Parts
  Usage Recording), R23 (Async Customer Selection).
- Intro line extended by one clause for the same traceability reason as
  above.

**Requirement count**: 7 total (3 unchanged, 1 modified, 3 added).

No REMOVED or RENAMED requirements in this delta — no destructive merge, no
`(Reason:)`/`(Migration:)` notes needed.

## Mechanical Copy Verification

Change folder move: `git mv openspec/changes/service-history-per-vehicle
openspec/changes/archive/2026-09-03-service-history-per-vehicle`, verified
against a pre-move recursive snapshot via `diff -r`:

```
DIFF_EXIT=0
```

(empty diff — no bytes altered by the move; this file, `archive-report.md`,
is additive and was written after the move, so it is correctly absent from
both sides of that comparison)

The two main-spec merges (customer-management, service-orders) were
editorial — `openspec/specs/{domain}/spec.md` already existed, so per the
archive skill's "If Main Spec Exists" branch, they were read and edited with
matching-by-requirement-name, not mechanically copied. The Mechanical Copy
Contract's shell-only requirement applies to the folder move and to
copying a delta spec when no main spec exists yet; neither condition
applied to `customer-management`/`service-orders` here.

## Deferred Follow-Ups Carried Forward

The 8 unchecked `tasks.md` items do not disappear into the archived folder.
They are now also recorded in `openspec/changes/archive/README.md` under a
new "Open follow-ups carried forward" section — the same file a future
reader already consults first when browsing `archive/` (it already carries
the equivalent register for `crm-shell-settings-rbac`). That section lists
all 8 by number with a one-line description and calls out **1.18** by name
as the one with real teeth: `createOrder` passes `createdBy` straight
through from the request body
(`src/modules/service-orders/service.ts:216`), so an API client can
attribute an order to another user. Pre-existing (not introduced by C4), but
worth fixing — the whitelist that would need to also strip/validate
`createdBy` from untrusted input is the same `.values()` map task 1.8's test
already pins as load-bearing.

The other 7 (1.19, 2.11, 2.12, 3.10, 3.11, 3.13, 3.15) are lower-severity
notes: a wire-format type mismatch nothing reads yet, a scope gap between
POST/PATCH validation hardening, a silent submit-gate UX nit, a
pre-existing English string, planned-not-premature duplication, an
unbounded-read cost recorded but not fixed, and a redundant test
assertion — full text preserved verbatim in both the archived `tasks.md` and
the README section.

## Verification Evidence Referenced

- `verify-report.md` (in the archived folder) — RE-VERIFY pass, verdict
  `pass_with_warnings`, `evidence_revision
  sha256:7bab2774245ae36ee0bb74017f89a99b3af6ffdddb66d6ae151af9fffa489901`,
  requirements 6/6, scenarios 30/30, `tsc` 0 errors, 79 files/1069 tests
  green (independently re-run in that session).
- Merged-result gate (launch-instructions final-state fact, not
  independently re-run by this archive phase, which touches no `src/`):
  1069 tests / 79 files, `npx tsc --noEmit` clean, `npm run lint` 0 errors /
  15 warnings, e2e 31/31 against throwaway `dforce_c4_e2e`.
- GGA per PR (launch-instructions final-state fact): #57 seven rounds
  PASSED, #58 six rounds converged, #59 five rounds PASSED, #60 seven rounds
  PASSED, #61 six rounds PASSED, #62 closed the verify gap.
- `npx tsc --noEmit` re-run by this archive phase after the spec merges:
  clean, 0 errors (expected — this phase touched only `openspec/`, no
  `src/`).

## Archive Verification Checklist

- [x] Main specs updated: `customer-management` (1 modified + 1 added
      requirement), `service-orders` (1 modified + 3 added requirements)
- [x] Change folder moved:
      `openspec/changes/service-history-per-vehicle/` →
      `openspec/changes/archive/2026-09-03-service-history-per-vehicle/`
- [x] Archive contains all artifacts: proposal.md, explore.md, design.md,
      specs/, tasks.md, verify-report.md, archive-report.md (this file)
- [x] Archived `tasks.md` unchecked boxes are a documented deferral
      register (8 items), not stale incomplete work — see Task Completion
      Gate
- [x] Active changes directory no longer contains
      `service-history-per-vehicle`
- [x] Verbatim `diff -r` readback: empty (`DIFF_EXIT=0`), included above
- [x] 8 follow-ups carried forward into `archive/README.md` where a future
      reader will encounter them

## Engram Observation IDs Read

- `sdd/service-history-per-vehicle/proposal` — #849
- `sdd/service-history-per-vehicle/spec` — #851
- `sdd/service-history-per-vehicle/design` — #852
- `sdd/service-history-per-vehicle/tasks` — #853
- `sdd/service-history-per-vehicle/verify-report` — #876 (RE-VERIFY, PASS
  WITH WARNINGS; earlier FAIL pass recorded separately at #877/#878, both
  superseded by #876 per the Final-State Authority hierarchy)

## SDD Cycle Closure

- Proposal: complete
- Spec: complete, merged into main specs
- Design: complete (D1–D6, all confirmed still honoured per the RE-VERIFY
  report, not re-audited by this archive phase)
- Tasks: complete, 41/49 checked, 8 deferred by design
- Apply: complete — 7 PRs (#56 tracker, #57–#62), merged to `main` @
  `1d02041`
- Verify: complete — PASS WITH WARNINGS, 30/30 scenarios
- Archive: complete — this report

The change is closed. Ready for the next change to depend on the
consolidated `openspec/specs/customer-management/spec.md` and
`openspec/specs/service-orders/spec.md`.

---

**Archived by**: SDD Archive Phase (sdd-archive skill)
**Timestamp**: 2026-09-03
**Filesystem**: `openspec/changes/archive/2026-09-03-service-history-per-vehicle/`
