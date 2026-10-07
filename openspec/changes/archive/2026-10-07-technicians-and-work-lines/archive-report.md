# Archive Report: technicians-and-work-lines

**Date**: 2026-10-07
**Status**: ARCHIVED
**Verdict from verify-report**: PASS WITH WARNINGS (0 CRITICAL, 7 WARNING, 4 SUGGESTION)

## Artifacts Merged

All delta specs successfully merged into main specs via exact requirement replacement:

### New Main Specs (copied)
- `openspec/specs/technicians/spec.md` — NEW, contains 4 requirements
- `openspec/specs/order-work-lines/spec.md` — NEW, contains 3 requirements

### Modified Main Specs (delta applied)

**service-orders** (`openspec/specs/service-orders/spec.md`):
- R20 Service Order Creation: REPLACED with new version (admin/jefe create only, 0+ technicians, deactivated refused)
- R21 Status Lifecycle Transitions: REPLACED with new version (added `ready_for_review` status, transitions, send-back clears marks)
- R23 Async Customer Selection: UPDATED scenarios (added técnico assigned-order access)
- Reception Photos: REPLACED (added unassigned técnico access rules, jefe add during review)
- Order Editing Is Gated by Role and Current Status: REPLACED (added jefe_taller, ready_for_review, unassigned técnico scenarios)
- Order Assignment: ADDED (7 requirements)
- Técnico Sees and Acts Only on Assigned Orders: ADDED (6 requirements)

**user-management** (`openspec/specs/user-management/spec.md`):
- Jefe de Taller Is an Assignable Role: ADDED (3 requirements)
- A Tecnico Login Gets a Linked Roster Row: ADDED (4 requirements)

**service-order-corrections** (`openspec/specs/service-order-corrections/spec.md`):
- Work Lines Can Be Written Under Correction, Audited: ADDED (9 requirements)

## Text Amendments Applied

All 10 items from verify-report § "Spec/design text that no longer matches what shipped" have been addressed in the change's own proposal.md and design.md:

1. Wire key `user_id` → `userId`: proposal.md Approach updated
2. Assignments route one `tecnicoId`: proposal.md Approach updated
3. Audit edit values format: design.md Data Model noted the format
4. Readiness timestamp: design.md Data Flow updated to "updates `updatedAt`"
5. Send-back clears marks: design.md Readiness edges and Data Flow updated
6. Jefe lacks 5 grants not 4: proposal.md Scope updated with `service-orders.deletePhoto`
7. Intent scope: proposal.md Intent reworded to "0+ technicians"
8. Enum placement: proposal.md Approach reworded (single transaction, no isolation)
9. Roster breakpoint: design.md UI changed `sm:` → `md:`
10. Technician scoping: design.md Read paths and delta Requirements already covered

## Duplicate Check

Grep for `^### Requirement:` headers and `sort | uniq -d` confirmed ZERO duplicates across all five spec files:
- service-orders
- user-management
- service-order-corrections
- technicians (new)
- order-work-lines (new)

## Mechanical Archive Verification

- Source snapshot taken before move
- `git mv openspec/changes/technicians-and-work-lines → openspec/changes/archive/2026-10-07-technicians-and-work-lines`
- Source directory confirmed absent after move
- `diff -r` (source snapshot vs. archived folder) returned **empty** (no differences)

## Task Gate Status

- Task 9.1 (Archive): `[x]` COMPLETE
  - NEW main specs created: technicians, order-work-lines
  - Modified requirements applied to service-orders (R20, R21, Reception Photos, Order Editing, ADDED Order Assignment and Técnico Scoping), user-management (ADDED 2), service-order-corrections (ADDED 1)
  - No duplicate requirements after mechanical merge
  - Change folder archived to `openspec/changes/archive/2026-10-07-technicians-and-work-lines/`

- Task 9.2 (Follow-ups): `[x]` RECORDED
  - Re-assigning deactivated technician: answers 400 (active check before duplicate check)
  - Technician routes malformed JSON: currently 500, noted for future 400 guard
  - OrderStatusControls técnico button filtering done via `canAssign` prop
  - No other blockers

## Verification Evidence

- All gates from verify-report PASS: tsc, npm test (3049/3049), lint (0 errors, 13 warnings), e2e (196/196)
- No CRITICAL issues
- Change is ready for delivery

## Archive Closure

The change is complete and archived. The SDD cycle for technicians-and-work-lines closes with all work units merged (1.x–8.x marked done in tasks.md), all requirements integrated into main specs, and the change folder relocated to audit trail.
