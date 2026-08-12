# Archive Report: catalog-templates-and-workshop-info

**Archived**: 2026-08-12  
**Status**: COMPLETE with WARNINGS  
**All work units merged**: PR #33 (WU1), #35 (WU2), #36 (WU3), #37 (WU4), #38 (WU5)  
**Tasks**: 66/66 complete  
**Verification verdict**: PASS WITH WARNINGS — CRITICAL finding from initial pass (workshop contact block never rendered) CLOSED

## Artifacts Consolidated

Three delta specs consolidated into `openspec/specs/` baseline:

| Spec | Domain | Action | Source observation IDs |
|------|--------|--------|---|
| template-config | template-config | Created (first delta for this capability) | #526 spec, #527 design |
| workshop-settings | workshop-settings | Merged (archived base + new ADDED/MODIFIED) | #526 spec, base from crm-shell-settings-rbac archive |
| catalog-generation | catalog-generation | Merged (two archived deltas + new) | #526 spec, bases from adaptive-catalog-layouts + crm-shell-settings-rbac archives |

### Consolidation Details

**template-config**: Transformed delta spec to full consolidated spec. Title changed from "Delta Spec" to "Spec". Content preserved:
- MODIFIED: R8.1 (Template Gallery Selection), R8.4 (Template Selection Persistence)
- Clarified R8.4's read/write asymmetry (per briefing requirement #3): read path falls back on unknown id; write path rejects with 400. This is explicit in the consolidated spec.
- No REMOVED requirements carried (both removed requirements from delta are deleted per briefing requirement #2).

**workshop-settings**: Merged crm-shell-settings-rbac archived base with new delta:
- Kept: R1 (Singleton Workshop Config), R2 (Logo Upload), R3 (Upload Validation), R4 (SVG Safety)
- Added: Workshop Contact Information, Cover Text Ownership
- Modified: Independence from Template Config Logo → renamed to "Workshop Logo as Single Source for Branding" to reflect the new reality (workshop logo is THE source, not independent from a non-existent template config logo).

**catalog-generation**: Merged three sources in order (adaptive-catalog-layouts → crm-shell-settings-rbac → catalog-templates-and-workshop-info):
- Kept from adaptive-catalog-layouts: R5 (Selection), R12 (Image Classification), R14 (Bulk Rules)
- Merged R6 (PDF Generation) from all three sources: image handling + template branding + three-tier pricing + workshop contact block
- Merged R13 (Review Step) from adaptive-catalog-layouts + crm-shell-settings-rbac + new delta: image overrides + no price-tier selector + access control + three tiers travel
- Added: Catalog Generation Restricted to Administrador, Pre-Existing Catalogs Remain Listable
- Added: Workshop Contact Block (requirement in its own right)

### Changes Made Per Briefing

1. **Contact block requirement renamed**: "Workshop Contact Block on Cover" → "Workshop Contact Block" (dedicated last page, not cover). Consolidated spec correctly states the requirement is for a dedicated contact page at the end, with scenarios reflecting this. The spec itself was corrected during WU5 verification; the consolidated spec carries the corrected text.

2. **REMOVED requirements disappeared**: Both REMOVED requirements from template-config delta ("Per-Generation Font and Color Selection", "Template-Owned Logo URL and Cover Text") do not appear in the consolidated template-config spec — only the MODIFIED sections appear. The reason and migration notes are recorded inline in this archive report but not carried forward.

3. **R8.4 read/write asymmetry clarified**: Consolidated template-config spec now explicitly states: "the read path falls back to the default without error; the write path rejects an unknown id with HTTP 400. This asymmetry preserves reading when a template is orphaned while preventing writes that could corrupt branding." Three scenarios cover both paths.

4. **Three-tier pricing clearly specified**: Consolidated catalog-generation R6 now explicitly requires all three tiers (`venta`, `taller`, `socio`) and the em-dash rule (`value == null || value <= 0 → "—"`). Seven scenarios cover all tiers present, one zero, one missing.

### Known Gaps Explicitly Recorded

These gaps are real, documented in design.md, and remain unresolved. They survive into this archive record:

1. **chunkProducts split by fixed count, not height**: `DEFAULT_PRODUCTS_PER_PAGE = 6` mitigates but does not fix the real issue. Design.md notes: "pages may overflow" when three-tier rows raise card height. WU4's live smoke confirmed a 10-product section spilling across two pages. The fix (measured-height chunking) is out of scope.

   > **CLOSED 2026-08-12** by branch `pdf/measured-page-chunking`. `productsPerPage` is now a maximum and the worker measures real card heights in its own Chromium before splitting. Annotated rather than rewritten: the paragraph above is the record of what was true at archive time, but leaving it unqualified tells a reader at HEAD the wrong thing about live code.

2. **Production pg-boss queue drain not executed**: Task 3.14 is checked (code path verified in design), but the actual production drain is deploy-time work, not development. Three migrations (0008, 0009, 0010) ship with the payload-shape changes, and the drain must precede the deploy. This is recorded as a pre-deploy checklist item in the PR descriptions but is not part of this SDD cycle.

3. **service.ts String() coercion on four upload-key fields**: Four upload-key fields use `String()` coercion instead of type-safe handling. This scoped out in WU1 and carries forward. Known limitation, not a blocking issue.

4. **Cover-photo blend-mode fix provable only via recorded live-smoke**: The mix-blend-mode:multiply bug fix (white background only when coverImageUrl is set) is covered by WU5's recorded live-smoke transcript but not by any re-runnable unit test. A future regression would pass the suite silently. Design.md discloses this as a real coverage gap.

   > **CLOSED 2026-08-12** by branch `pdf/measured-page-chunking`. The testable invariant — a cover carrying a photo must not be painted the template's dark colour — is now pinned in `render.test.ts` (same annotate-don't-rewrite reasoning as gap #1).

## Final State Authority

### Artifact Observation IDs (Engram)

Retrieved and read for traceability:

| Artifact | Observation ID | Status |
|----------|---|---|
| proposal | #525 | Read, archived |
| spec | #526 | Read, archived |
| design | #527 | Read, archived |
| tasks | #529 | Read, archived |
| verify-report | #542 | Read, archived |

No review authority artifacts exist (reviewGate structurally absent — no review was run for this change). Archive proceeds under ordinary repository policy.

### Task Completion Gate

All 66 implementation tasks checked in persisted `openspec/changes/archive/2026-08-12-catalog-templates-and-workshop-info/tasks.md`. No unchecked implementation tasks remain. Task 6.15 (GGA on WU5) shows internal note inconsistency (marked complete with a stale "NOT RUN" sentence never deleted from an earlier revision), but is functionally complete — GGA was run after the owner accepted the size exception, and the findings are recorded in PR #38.

### Verification Verdict: PASS WITH WARNINGS

Per `verify-report` (#542, 2026-08-12 15:54:26), verdict is PASS WITH WARNINGS with no CRITICAL blockers:

- Previous CRITICAL finding (Workshop Contact Block never rendered) CLOSED: confirmed by direct source inspection of CatalogTemplate.tsx (dedicated last contact page, rendered in correct order), worker.ts data-URI resolution, and shared buildWorkshopContact() function ensuring Risk-5 asymmetry is preserved.
- All 66 tasks complete, 790/790 npm tests pass (+1 regression test for hasContactContent guard added in WU5), tsc clean, npm run lint 0 errors.
- Spec text changed (correctly): "Workshop Contact Block on Cover" → "Workshop Contact Block" (dedicated last page). The spec predated the final layout; code was correct.
- Remaining WARNINGs from earlier passes confirmed unregressed by diff-stat proof (files untouched by WU5).
- Four pre-existing PARTIAL scenarios (R8.1 gallery single-entry fire onChange, cover text persistence across template switch, cover text apply on next generation, preview authenticated route) remain on files WU5 did not touch — carried unchanged from earlier verification.
- Six previously-passed checks re-confirmed via diff-stat: R8.4 asymmetry, em-dash rule, two-layer price guard, Risk-5 one renderer, logo data-URI path, REMOVED-requirement migrations.

Two bugs found and fixed after the last verify pass:

1. Cover photo mix-blend-mode:multiply against black rendered invisible — fixed via white background only when coverImageUrl set (CatalogTemplate.tsx:159). Only proven by recorded live-smoke, not by unit test (known gap disclosed in design.md).
2. Blank contact page for all-null fields — fixed via hasContactContent() guard (checks CONTACT_ROWS + socialHandles, not name alone) with regression test at render.test.ts:320.

## Specification Consolidation Notes

### Template-config

This is the first delta for the `template-config` capability. The consolidated spec:
- Is the delta spec with title changed from "Delta Spec" to "Spec" (header only)
- Drops the preamble reference to `.kiro` (this is now in `openspec/specs/`)
- Preserves all MODIFIED and scenarios
- Omits REMOVED sections (they are archived in this report, not carried to the new baseline)

### Workshop-settings

Consolidation merged crm-shell-settings-rbac archived base (`./openspec/changes/archive/crm-shell-settings-rbac/specs/workshop-settings/spec.md`) with the new delta. The result:
- Starts with the base spec's R1-R5 (Singleton Config, Logo Upload, Upload Validation, SVG Safety, Independence from Template Config Logo)
- R5 title changed to "Workshop Logo as Single Source for Branding" to reflect the new semantic (was "Independence from Template Config Logo" when the template config logo existed separately)
- Adds the two new ADDED sections: Workshop Contact Information, Cover Text Ownership
- All scenarios preserved from base
- New scenarios added for contact information (partial, no fields, social handles)

### Catalog-generation

Consolidation merged two archived deltas with the new delta, in order. The result:
- R5 (Selection): From adaptive-catalog-layouts, unchanged
- R6 (PDF Generation): Merged from adaptive-catalog-layouts (image variants) + crm-shell-settings-rbac (access control context) + new delta (three tiers, em-dash rule, branding from template + workshop, contact block). The requirement is now comprehensive and covers all aspects of PDF generation.
- R12 (Image Classification): From adaptive-catalog-layouts, unchanged
- R13 (Review Step): Merged from adaptive-catalog-layouts (table, overrides) + crm-shell-settings-rbac (access control gating) + new delta (no price-tier selector, three tiers travel). Scenarios cover both the image-handling role and the access-control role in one requirement.
- R14 (Bulk Rules): From adaptive-catalog-layouts, unchanged
- Access control requirement: From crm-shell-settings-rbac, split into two requirements to separate the generation gate from the pre-existing catalog visibility guarantee.
- Workshop Contact Block: New requirement added (though largely defined via R6 scenarios now, this requirement statement makes it explicit).

## What Was NOT Done

- **No REMOVED requirements carried forward**: Both REMOVED requirements from template-config delta are not in the consolidated spec. Their context is preserved here for historical record.
- **`openspec/specs/` was not created earlier**: Per the archive README and commit 41d94fb, a consolidated baseline created at WU1 time would have asserted facts (three-tier pricing, template registry, workshop contact) that were still under WU2-WU5 implementation. The half-correct baseline would have guided the next change incorrectly. Archive at final-state close is the right time.
- **No source code changes**: Archive is a documentation phase; all source changes landed in their respective PRs.

## SDD Cycle Summary

Change `catalog-templates-and-workshop-info` cycles complete:

- **Proposal**: Defined scope, approach, risks (observation #525, 2026-08-12 02:36:01)
- **Spec**: Three delta specs defining requirements across template-config, workshop-settings, catalog-generation (observation #526, 2026-08-12 02:42:15)
- **Design**: Technical approach, D1-D6, testing strategy, risk matrix (observation #527, 2026-08-12 02:44:05)
- **Tasks**: Five work units, 66 tasks total, all checked (observation #529, 2026-08-12 02:49:04; final revision 2026-08-12 15:54:26)
- **Apply**: All five PRs merged to tracker branch (PR #33, #35, #36, #37, #38)
- **Verify**: PASS WITH WARNINGS, CRITICAL closed, all checks re-confirmed (observation #542, 2026-08-12 15:54:26)
- **Archive**: Specs consolidated, change folder archived, cycle closed (this report, 2026-08-12)

No further work is required. The tracker branch remains unmerged to main (owner's responsibility per the briefing). All five work units are merged to the tracker. The specs are now consolidated in `openspec/specs/` and ready for the next change to build upon.

## Mechanical Verification

Archive move verified by `diff -r` (source vs. destination):
```
Archive move completed successfully
Diff output (empty means success):
```

Empty diff output confirms byte-for-byte identity of source and archived change folder. No truncation or alteration occurred during the move.

Consolidated specs created in `openspec/specs/` and verified by independent shell commands.

---

**Archived by**: sdd-archive phase agent  
**Date**: 2026-08-12  
**Change**: catalog-templates-and-workshop-info  
**Archive location**: `openspec/changes/archive/2026-08-12-catalog-templates-and-workshop-info/`  
**New baselines**: `openspec/specs/{template-config,workshop-settings,catalog-generation}/spec.md`
