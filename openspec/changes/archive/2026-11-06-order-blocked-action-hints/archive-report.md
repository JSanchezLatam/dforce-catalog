# Archive Report: order-blocked-action-hints

**Status**: Archived and closed
**Archived**: 2026-11-06
**Change**: `order-blocked-action-hints`
**Archived to**: `openspec/changes/archive/2026-11-06-order-blocked-action-hints/`
**Merged**: `main` 2026-11-06 as PR #335 (tracker); work units #336–#342; related #334 (Spanish refusal defaults)
**Verified**: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING accepted as follow-ups, 3 SUGGESTION), per `verify-report.md`
**Artifact store**: hybrid. Engram was unavailable in this session (no `mem_*` tools), so no observation IDs were read or saved. The filesystem copies below are the record of this archive.

## Executive Summary

The `order-blocked-action-hints` change is merged and archived. Its delta specs were merged into three main specs: `service-orders` (1 MODIFIED, 3 ADDED), `kanban-board` (2 MODIFIED) and `order-work-lines` (1 MODIFIED). Task 7.3 remains open by an explicit, accepted deviation. Task 7.4 was closed by this archive.

## Final State at Close

Ranked per the archive skill's Final-State Authority. The launch prompt's final-state facts outrank the intermediate `verify-report.md`.

| Fact | Source (rank) | Value at close |
|------|---------------|----------------|
| Merged to `main` | Launch prompt (3) | 2026-11-06, PR #335 |
| Tests on `main` | Launch prompt (3) | 4550/4550 pass (`verify-report` recorded 288 files, 4550 tests, at verification time) |
| Typecheck | Launch prompt (3) | `tsc --noEmit` clean |
| Lint | Launch prompt (3) | 0 errors, 13 warnings (baseline unchanged) |
| CRITICAL issues | `verify-report` (4), no later contradiction | 0 |
| WARNING issues | Launch prompt (3) | 3, accepted as follow-ups (see below) |
| Task 7.3 | Launch prompt (3) | Open, accepted deviation |
| Task 7.4 | Launch prompt (3) | Done, closed by this archive |

### Snapshot claims superseded at close

The following statements in `verify-report.md` were true at verification time and are no longer the state of the change:

- Gates section, "Tasks: all checked except 7.3 ... and 7.4 (tracker integration/merge/archive, this phase's gate)". Superseded: 7.4 is closed.
- WARNING 2, "Task 7.4 open (tracker integration check, archive)". Superseded: 7.4 is closed by this archive, with the gates on `main` cited above.
- WARNING 2, "design.md D5 still says otherwise". Superseded: `design.md` D5 now reads "no `aria-label`... this supersedes the original aria-label plan" (checked at archive time).

No contradiction was left unresolved.

## Task Completion Gate

Tasks artifact: `tasks.md`, 35 of 36 checked after this archive (34 before).

- **Task 7.3 (open, not reconciled).** Both técnico empty states (linked and unlinked) were not checked in a browser at the LAN IP. This is a genuinely open task, not a stale checkbox, so the skill's exception does not cover it. The archive proceeded only under the explicit orchestrator instruction "Tasks 7.3 open (accepted, follow-up)". This is a recorded gate deviation. Coverage: 5 page tests with mutations (`verify-report`, at verification time).
- **Task 7.4 (reconciled).** Ticked `- [ ]` to `- [x]` in the archived `tasks.md`, line 94. Reconciliation reason: the orchestrator instructed "7.4 done by this archive", and the final-state facts show the tracker merged to `main` with the gates green. Only the checkbox changed; the readback diff against the pre-move snapshot shows this one line and nothing else. The tick was applied after the move, to the archived copy, because the first attempt to tick the source failed on argument parsing.

## Specs Synced

Merge method: each MODIFIED requirement replaced the main requirement of the same name, with no duplicate left standing. ADDED requirements were appended in delta order. Untouched requirements were not changed.

| Capability | Action | Requirements | Requirement count (before → after) |
|------------|--------|--------------|------------------------------------|
| `service-orders` | Updated | MODIFIED "Status Labels, Badge and List Filter"; ADDED "Order Detail Action Bar", "Blocked-Action Hints on Order Detail", "Empty Order List for a Técnico" | 30 → 33 |
| `kanban-board` | Updated | MODIFIED "Move Rules", "Card Menu and Urgent Toggle" | 10 → 10 |
| `order-work-lines` | Updated | MODIFIED "Work Line and Mark Interface" | 4 → 4 |

Post-merge checks:

- **Block-level readback** (per capability, in scratch): every delta block matched byte-for-byte in the merged output; every pre-merge block not named in the delta matched byte-for-byte; the counts reconcile (30 + 3 = 33 for `service-orders`).
- **Installed-file readback**: the merged candidates were copied into `openspec/specs/<capability>/spec.md` with `cp`, and `diff -r` candidate vs installed was empty for all three.
- **Duplicate headings**: `uniq -d` over `### Requirement:` headings in all three main specs is empty.
- **Leftover delta headers**: none (`# Delta for`, `## ADDED`, `## MODIFIED` absent from main specs).
- **`aria-label` grep**: the only matches are the decision text itself ("no `aria-label`", "no status button MUST carry an `aria-label`") in `service-orders`. The status buttons have no `aria-label`; the visible short label is the accessible name. No text contradicts this.

## Archive Move

The change folder was moved with a plain `mv` (not `git mv`), so the git index was not touched. `verify-report.md` was untracked before the move, so the orchestrator will need `git add` for the rename and the new files.

## Archive Contents

- `proposal.md` (present)
- `specs/service-orders/spec.md`, `specs/kanban-board/spec.md`, `specs/order-work-lines/spec.md` (present)
- `design.md` (present)
- `tasks.md` (present, 35/36 checked; 7.3 open by accepted deviation)
- `verify-report.md` (present)
- `mockup/index.html` (present)
- `archive-report.md` (this file)

## Follow-ups Carried Forward

Recorded in `openspec/changes/archive/README.md`, under "Open follow-ups carried forward", subsection `order-blocked-action-hints`. Summary:

- Task 7.3, both técnico empty states in a real browser at the LAN IP (WARNING 1, accepted).
- Browser checks not performed: tablet long-press drag (task 6.6); Recibida menu at tablet and phone widths; dark mode on the work card and the menu item (WARNING 3, accepted). The owner's Chrome device extension was not used; Playwright at the LAN IP was used instead.
- Verify SUGGESTIONs 1–3 (a render assertion for the marked-técnico hint; naming `jefe_taller` in a test; a DndBoard drag test for the diagnosing-card copy).
- "Editar orden" at 12.8px (`size=sm` in `ServiceOrderForm`) beside Imprimir at 14px.
- `status-hue.test.ts` imports from `modules/` (shared-to-modules rule), test only.
- Remove the HSTS header from `next.config.ts:69`.
- Standard labor hours.
- Inventory items out of scope: agenda non-booked items; bulk status explanation; vehicle-with-orders delete; portal code; race and stale generic messages; empty-roster assign copy; account refusals tú→voseo; info-toast contrast 4.4:1.

## Traceability

- Sources read from the filesystem (hybrid mode): `proposal.md`, `specs/*/spec.md` (three delta specs), `design.md`, `tasks.md`, `verify-report.md`.
- Engram observation IDs: none. Engram was unavailable, so no `sdd/order-blocked-action-hints/*` observation was read, and this report was not saved to Engram by this archive. Save it to Engram when the tools are available.
