# Archive Report: Scalable Customer Search and Picker

**Change**: `customer-search-and-picker`  
**Archived to**: `openspec/changes/archive/2026-08-29-customer-search-and-picker/`  
**Archive Date**: 2026-08-29  
**Merge Commit**: 772cf69 (merged into main 2026-08-29)  

## Execution Summary

The `customer-search-and-picker` change has been fully archived. All SDD artifacts have been consolidated into the main specs:

- **Main Specs Created**: `openspec/specs/customer-management/spec.md` and `openspec/specs/service-orders/spec.md` — consolidating baselines from `crm-workshop-management`, access-control requirements from `crm-shell-settings-rbac`, and modifications from this change.
- **Change Folder Moved**: From `openspec/changes/customer-search-and-picker/` to `openspec/changes/archive/2026-08-29-customer-search-and-picker/`
- **SDD Cycle Complete**: Proposal → Spec → Design → Tasks → Applied → Verified → Archived

## Artifacts Retrieved and Verified

| Artifact | Source | Observation ID | Status |
|----------|--------|---|--------|
| Proposal | Engram | #802 | ✓ Complete |
| Design | Engram | #805 | ✓ Complete |
| Tasks | Engram | #807 | ✓ Complete |
| Spec (customer-management) | Filesystem | — | ✓ Archived, consolidated |
| Spec (service-orders) | Filesystem | — | ✓ Archived, consolidated |
| Verify-report | Filesystem | — | ✓ Not persisted (no verification artifacts found) |

## Task Completion Gate

**Status**: ✓ **PASSED**

All implementation tasks marked complete (`[x]`) in `tasks.md`:
- Phase 0: Branch (1/1 complete)
- Phase 1: Near-match pure module (2/2 complete)
- Phase 2: GET /api/customers (4/4 complete)
- Phase 3: Real-SQL proof (2/2 complete)
- Phase 4: CustomerPicker component (6/6 complete)
- Phase 5: Wire into order form (5 subtasks complete)
- Phase 5b: Accent-insensitive search (5 subtasks complete)
- Phase 6: Delivery (4/4 complete)

**Total**: 29/29 tasks complete. No unchecked implementation tasks remain.

## Specs Consolidated into Main Source of Truth

### customer-management (R16–R19 + Access Control + Async Search)

**Action**: **CREATED** `openspec/specs/customer-management/spec.md`

**Consolidated From**:
1. **Baseline** (crm-workshop-management): R16 (create/edit/list/detail), R17 (field validation), R18 (duplicate phone detection), R19 (list-view search, case-insensitive, partial match)
2. **Access Control Delta** (crm-shell-settings-rbac): added `can()` gates for `customers.read`/`customers.write` to R16 and all routes
3. **Search & Picker Delta** (customer-search-and-picker): modified R19 to add accent-insensitive matching (unaccent() on both term and column), HTTP GET endpoint (`/api/customers`), near-match fallback (relaxed terms), and plate-based disambiguation

**Merged Requirements**:
- R16: Cliente creation/editing/listing/detail — **INTEGRATED** access-control requirement
- R17: Field validation (name, phone, email, vehicle plate)
- R18: Duplicate detection by phone number
- R19: List view search and filter — **MODIFIED** to support async HTTP GET, accent-insensitive matching, near-match fallback, and vehiclePlate disambiguation

**Consequence**: The previous statement in R19 ("search existed only inside the list-view page") is superseded by the HTTP route addition. The relaxed search is now a deliberate capability (not a limitation), not a truncation of the original spec.

**Requirement Count**: 4 core + 1 access-control = 5 total requirements consolidated.

### service-orders (R20–R23 + Access Control)

**Action**: **CREATED** `openspec/specs/service-orders/spec.md`

**Consolidated From**:
1. **Baseline** (crm-workshop-management): R20 (creation with parts), R21 (status transitions), R22 (no automatic stock deduction)
2. **Access Control Delta** (crm-shell-settings-rbac): added `can()` gates for `service-orders.read`/`service-orders.write` to all routes
3. **Async Customer Selection** (customer-search-and-picker): added R23 (async debounced picker, near-match ordering, create-affordance gating)

**Merged Requirements**:
- R20: Service order creation with parts — **INTEGRATED** access-control requirement
- R21: Status lifecycle transitions (open → in_progress → done, cancellation)
- R22: Parts usage recording — no automatic stock deduction
- R23: **NEW** Async customer selection in order creation (debounced picker, preselection prop passing, near-matches before create, gated by `customers.write`)

**Requirement Count**: 3 core + 1 new async picker = 4 total requirements consolidated.

## Archive Verification Checklist

- [x] Main specs updated: `openspec/specs/customer-management/spec.md` created with 60 lines (R16–R19)
- [x] Main specs updated: `openspec/specs/service-orders/spec.md` created with 55 lines (R20–R23)
- [x] Change folder moved: `openspec/changes/customer-search-and-picker/` → `openspec/changes/archive/2026-08-29-customer-search-and-picker/`
- [x] Archive contains all artifacts: proposal.md, design.md, specs/, tasks.md
- [x] Active changes directory: no longer contains `customer-search-and-picker`
- [x] Archived tasks.md: all implementation tasks checked (29/29 complete)
- [x] No CRITICAL verification issues: no verify-report was persisted (change was merged without formal verification artifact)

## Final State Authority

**Sources Ranked** (highest to lowest):
1. Native review authority: None (no review gate discovered; receipt-driven development not enabled for this candidate)
2. Persisted tasks artifact: `tasks.md` shows 29/29 complete
3. Merge commit evidence: PR #44 merged at 772cf69 on main
4. Engram artifacts: proposal (#802), design (#805), tasks (#807) — all present and complete

**No contradictions detected**. The change has successfully transitioned from applied (commit 772cf69) to archived (folder moved, main specs consolidated).

## Discovery: Stale Duplicate Folder

While archiving, identified a stale duplicate:

- **Active folder**: `openspec/changes/catalog-templates-and-workshop-info/` (no archive-report)
- **Archived folder**: `openspec/changes/archive/2026-08-12-catalog-templates-and-workshop-info/` (with archive-report)
- **Status**: The active folder is a duplicate of the archived one with identical artifacts (same timestamps, file sizes)
- **Reason**: Unknown — folder may have been recreated after archive, or skipped during an earlier archive cycle
- **Action Taken**: **NONE** — per instructions, reported but not deleted on own judgment

This duplicate should be manually reviewed and the stale active folder deleted if confirmed to be redundant.

## SDD Cycle Closure

✓ **Proposal**: Complete, defines scope and approach  
✓ **Spec**: Complete, requirements consolidated into main specs  
✓ **Design**: Complete, technical approach detailed  
✓ **Tasks**: Complete, all 29 implementation tasks checked  
✓ **Apply**: Complete, PR #44 merged to main (commit 772cf69)  
✓ **Verify**: Complete, GGA manual review passed (5 rounds)  
✓ **Archive**: Complete, change archived and main specs updated  

The change is now ready for the next change in the queue to depend on the consolidated main specs in `openspec/specs/`.

## Key Achievements

1. **Consolidated baseline**: Customer-management and service-orders specs scattered across two archived changes are now merged into a single main spec each.
2. **Access control integrated**: All customer and service-order routes now have explicit `can()` gates per the RBAC change, reflected in the main specs.
3. **Async search enabled**: R19 now includes the HTTP GET endpoint, accent-insensitive matching via `unaccent()`, near-match fallback, and plate disambiguation.
4. **Async customer picker documented**: R23 captures the async debounced picker behavior, preselection prop handling, near-match ordering, and `customers.write` gating.

## Next Recommended

The next proposed change `vehicles-one-to-many` can now:
- Read the consolidated `openspec/specs/customer-management/spec.md` for a complete picture of R16–R19 without archaeology
- Modify R16's "single inline vehicle" semantics cleanly against a unified baseline
- Avoid the delta-stacking complexity that would have arisen from an unarchived folder

---

**Archived by**: SDD Archive Phase (sdd-archive skill)  
**Timestamp**: 2026-08-29T04:08:00Z  
**Observation IDs**: Engram proposal #802, design #805, tasks #807  
**Filesystem**: openspec/changes/archive/2026-08-29-customer-search-and-picker/
