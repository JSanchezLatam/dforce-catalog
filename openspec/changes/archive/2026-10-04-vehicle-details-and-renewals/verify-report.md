# Verification Report: vehicle-details-and-renewals

Mode: Strict TDD, hybrid. Base: main @ bf86655 (PRs #151-#157 merged).
Verdict: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING, 1 SUGGESTION)

## Evidence
| Command | Exit | Result |
|---|---|---|
| `npm test` | 0 | 144 files, 2028/2028 passed |
| `npx tsc --noEmit` | 0 | clean |
| e2e (vehicle-details, vencimientos) | not re-run | run on throwaway DB during apply; files present and cover Real SQL |

Orchestrator browser evidence (2026-10-04, LAN IP 192.168.0.3:3000) accepted as given: tecnico RSC payload carries no internal fields (customer and vehicle pages); unchanged saves preserve DB values for both roles; print preview keeps 900 chars of Hallazgos with signature on page 1; vencimientos list/badge 6->5/collapsed dot/phone cards/tecnico refused with no nav item; dialog wa.me carries 50766518556, opt-out disabled with reason, close button 44x44, console clean.

## Tasks
37 ticked. 2 unticked, both archive-phase notes, not implementation: 6.1 (merge delta specs; happens at sdd-archive) and 6.2 (follow-ups, explicitly out of scope). No core task pending.

## Spec compliance (3 specs, 43 scenarios, all COMPLIANT)

### customer-management
- Fields round-trip: validation.test.ts:222; e2e vehicle-details:80; CustomerForm.test.tsx:908
- Invalid estilo/motor rejected: validation.test.ts:244,248
- Tecnico save preserves internal: e2e:87; route.test.ts:417; CustomerForm.test.tsx:977
- Tecnico sending internal refused: e2e:97; customers/[id]/route.test.ts:411
- Admin omitting preserves: e2e:107; vehicles.test.ts:263; validation.test.ts:268
- Admin clears explicitly: e2e:107; vehicles.test.ts:270; CustomerForm.test.tsx:1029,1045
- Internal absent from route: vehicles/route.test.ts:65,79; vehicles.test.ts:533
- Navigate from vehicle card / only that vehicle's orders / history row / empty / deactivated / hidden from tecnico: vehicles/[vehicleId]/page.test.tsx:50,83,94,60,71,146; customers/[id]/page.test.tsx:235,249

### service-orders
- Vehicle and category shown / unset notes / deactivated: [id]/page.test.tsx:95,104,169
- Descriptive fields, unit conditional: page.test.tsx:209,226,236
- Internal absent from detail: page.test.tsx:246
- Sheet names workshop / no logo / back control hidden / Imprimir navigates: print/page.test.tsx:441,461,477; [id]/page.test.tsx:335,347
- Page carries data / handwriting space / same read gate: print:184,226,238,268,290,303,349
- New vehicle fields on sheet / internal absent: print:131,150,164

### vehicle-renewals
- Admin edits internal / month out of range / tecnico form hides: CustomerForm.test.tsx:1029,977; e2e vehicle-details:121; customers/[id]/page.test.tsx:235
- Plate window (current+next, long after, Dec wrap, overdue wrap, Panama date): due.test.ts:15,26,44,34; service.test.ts:83
- Insurance (30 days, overdue listed): due.test.ts:75,88
- Contactado (hide, idempotent, new expiry resets, plate next year): service.test.ts:70,106,153; due.test.ts:109,115; e2e vencimientos:83,104
- Dialog (wa.me encodes, open leaves uncontacted, opt-out, email not built): ContactDialog.test.tsx:108,123,137,161
- Message (price present/absent, overdue, missing workshop, missing make/model): message.test.ts:24,35,43,50,58,82
- Page and badge (equal rows, clears): service.test.ts:33; nav-badges.test.ts:38; layout.test.tsx:34,43; app-sidebar.test.tsx:216
- Admin-only: vencimientos/page.test.tsx:85; contact/route.test.ts:23; nav-items.test.ts:138; nav-badges.test.ts:46
- Real SQL: e2e vencimientos:65,83,104,116,128 (not re-run here)

## Assertion quality
No tautologies or ghost loops found in vencimientos tests (rg scan). Mutation-verify tasks (1.x-5.x) ticked per tasks.md.

## Issues
CRITICAL: none.
WARNING:
1. apply-progress artifact (TDD Cycle Evidence table) could not be retrieved: no Engram tools in this executor and no apply-progress file under openspec. TDD compliance rests on tasks.md ticks and passing suite, not on the evidence table.
2. e2e suites not re-run in this verification; Real SQL scenario and the injected-seam limit rely on apply-time runs.
3. Browser-only scenarios (RSC boundary, print preview, hit targets) rely on orchestrator evidence, not reproducible by test.
SUGGESTION:
1. Tick or move tasks 6.1/6.2 at archive so tasks.md closes cleanly.

## Verdict
PASS WITH WARNINGS. Next: sdd-archive.
