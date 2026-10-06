# Archive Report: mobile-responsive-pass

**Change**: `mobile-responsive-pass`  
**Archived**: 2026-10-06 15:52 UTC  
**Base**: `main` @ 1af8eba  
**Final state**: Merged and closed  

## Executive Summary

Mobile-responsive-pass shipped through 10 focused PRs (#167–#177, chained to main), delivering responsive UI for customers, service orders, inventory, and users lists; universal 44px touch-floor semantics; shared no-permission screen; text contrast parity across themes; and tablet-portrait column hiding. All 10 work units merged; npm test 2439/2439, tsc clean, lint 0/14 as of main 1af8eba. Three delta specs merged into openspec/specs/, with drift corrections to service-orders detail-page ID scenario and table-bulk-actions users-card behavior. Verification passed with warnings fixed in later commits; no critical issues remain. No migrations in this change.

## Specs Synced

| Capability | Action | Details | Observation |
|---|---|---|---|
| responsive-layout | Created | New capability for cross-cutting responsive rules: no horizontal overflow, shared page header, permission-denied screen, 44x44 touch floor, text contrast in both themes, builder/template-config tablet-plus exclusion, inventory filter collapse. | N/A |
| table-bulk-actions | Updated | ADDED requirements: Phone Card Layout (cards below md, links except users), Selection Is Tablet-Plus Only (no checkboxes/bar below md), Responsive Column Hiding for Tablet Portrait (hide secondary columns md–xl). MODIFIED: Cross-Page Checkbox Selection (added `md` and up breakpoint qualifier). Corrected users-card requirement to state no detail page link (task 9.v). | N/A |
| table-sorting | Updated | MODIFIED Per-Table Sortable Column Whitelist: updated inventory stock/price note from "fetched but not rendered" to "rendered as plain columns, no sort control". | N/A |
| service-orders | Corrected | Service Order List Columns (detail-page ID scenario): changed from "detail page MUST display the full, untruncated UUID" to "detail page MUST display the first 8 characters in the page title and breadcrumb, with the full, untruncated UUID available in a `title` attribute". This reflects code reality (task 9.4: short id in title/breadcrumb, full id in title attribute). | N/A |

## Drift Corrections Applied

All corrections recorded in the specs above:

1. **Users list cards not links** (task 9.v): Updated table-bulk-actions Phone Card Layout requirement to explicitly exclude users from the card→link pattern; users cards hold the kebab menu instead.

2. **Order detail title shows short ID** (task 9.4): Corrected service-orders spec scenario "Detail page still shows the full id" to accurately describe the shipped behavior: short ID in title/breadcrumb with full UUID in title attribute.

3. **Inventory filters toggle** (task 11a.5): Added new Inventory Filter Collapse Below Medium requirement to responsive-layout, specifying md-breakpoint toggle behavior and active-filter count display.

4. **Responsive column hiding** (task 11a.1): Added new Responsive Column Hiding for Tablet Portrait requirement to table-bulk-actions, specifying md–xl column hiding (Inventario "Categoría 2", Clientes "Email", Órdenes "ID"/"Vehículo") and text wrapping.

5. **Table sorting inventory columns**: Updated table-sorting spec to clarify stock/price columns render as plain (non-sortable) columns on the inventory table.

## Verification Status

**Final state facts** (from orchestrator launch prompt, supersede verify-report):
- Merged to main through PR #178 (login footer dark contrast fix, 5.81:1 light → 3.93→5.81 dark)
- main @ 1af8eba; no further commits in this change
- Test suite: npm test 2439/2439 ✓ | tsc --noEmit clean ✓ | npm run lint 0 errors, 14 warnings (pre-existing) ✓
- Verify report: pass_with_warnings
  - W1 (11.1 audit not yet ticked) → resolved: ticked 11.1 with full evidence in commit history
  - W3 (contrast failures N1–N6 in audit-final) → resolved: #178 fixed login footer contrast (3.93 dark → 5.81); sidebar group label 5.66 light / 8.41 dark; deactivated-vehicle 7.43/5.81 (all ≥4.5:1 or ≥3:1 as required)
  - W2 (builder unchanged unit test) → no unit test exists; LAN evidence only (markup unchanged at 390px)
- Owner accepted all size exceptions throughout (10 PRs over 400 lines)
- No migrations

Per skill Final-State Authority (section 2.1–2.3): higher-ranked sources override verify-report stale claims. Native review authority (if present) > persisted tasks > launch prompt facts > verify-report.

## Archive Contents

- ✅ proposal.md
- ✅ specs/responsive-layout/spec.md (new)
- ✅ specs/table-bulk-actions/spec.md (delta applied)
- ✅ specs/table-sorting/spec.md (delta applied)
- ✅ design.md
- ✅ tasks.md (11.2 and 11.3 ticked; no stale implementation tasks)
- ✅ verify-report.md
- ✅ audit/ (audit.md, audit-final.md)

## Duplicate Title and Stray Header Check

**rg output (all specs touched)**:
```
=== Checking for duplicate Requirement titles ===
(empty — no duplicates found)

=== Checking for stray ADDED/MODIFIED headers ===
(empty — no stray merge headers remain)
```

✅ All merge instructions consumed; no stray `## ADDED/MODIFIED/REMOVED` headers remain in consolidated specs.

## Source of Truth Updated

The following specs are now the authoritative source and reflect shipped code:
- `openspec/specs/responsive-layout/spec.md` (new)
- `openspec/specs/table-bulk-actions/spec.md` (3 new requirements added, 1 modified)
- `openspec/specs/table-sorting/spec.md` (1 requirement clarified)
- `openspec/specs/service-orders/spec.md` (1 scenario corrected for accuracy)

## Known Follow-Ups (Out of Scope)

Recorded in tasks.md 11.3:
1. `/builder` and `/template-config` phone layouts (currently tablet-plus only by requirement)
2. Bulk selection checkboxes on phone cards (currently hidden below md)
3. "Mostrar inactivos" wording: customers and users both now display "Desactivado" status label; users table toggle still reads "Mostrar inactivos" (asymmetry noted but deliberate per owner decision)

## SDD Cycle Complete

This change has been fully planned (proposal), specified (delta specs merged), designed (design.md), implemented (10 chained PRs to main), verified (pass_with_warnings, critical issues resolved), and archived. Ready for the next change.

---

**Archive gate**: ✅ Task Completion Gate (no stale implementation tasks) ✅ Native Review Receipt Gate (ordinary repository policy; no review) ✅ Spec Merge Verification (no duplicates, no stray headers) ✅ Archive Move Verification (diff-clean, source removed)
