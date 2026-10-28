# Verify report: kanban-board

Date: 2026-10-28. Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 4 WARNING, 3 SUGGESTION). Verified on `main` @ fce2d9f.

The `sdd-verify` executor ran the gates and the spec walk. The orchestrator wrote this file, because the executor's validator command (`gentle-ai sdd-verify-validate`) is not installed.

## Evidence

| Check | Result | Run by |
|---|---|---|
| `npx vitest run` | 282 files, 4357 tests passed | verifier |
| `npx tsc --noEmit` | clean | verifier |
| `npm run lint` | 0 errors, 13 warnings (baseline) | verifier |
| e2e, fresh `dforce_e2e` | 34 files, 397 tests passed | orchestrator, on the merged tip |
| Browser at http://192.168.0.7:3000 on merged main | agenda, kanban, `/tablero`, `/service-orders`; desktop and 390; light and dark; no console errors; no page horizontal scroll | orchestrator |

Spec coverage:

| Spec | Requirements | Scenarios |
|---|---|---|
| kanban-board | 10 | 26 |
| service-orders | 1 | 5 |
| workshop-status-board | 3 | 15 |
| Total | 14 | 46 |

- Every `[unit]` scenario has a passing test.
- Every `[e2e]` scenario has a test, in `src/e2e/order-urgent.e2e.test.ts`, `src/e2e/kanban.e2e.test.ts`, `board.e2e.test.ts` and `board-routes.e2e.test.ts`.

## Findings

### WARNING

1. **`[browser]` scenarios rest on manual checks.** They cover the insecure context, hit targets, legibility, and hydration/RSC errors. The checks are recorded in tasks 3b.5, 4b.4, 5.3, 6.4, 7.3 and 8.1. They were made at the LAN IP (`192.168.0.7`), which is an insecure context, but from the server machine, not from a second one.
2. **Task 8.1** has now been recorded with the owner's merge approval.
3. **Freshness label.** The spec said "Actualizado hace N s", but the code reads "hace menos de 30 s" while polls succeed. The spec was amended before archive.
4. **Tasks that differ from their original wording.** All are documented in `apply-progress.md`:
   - On the TV, the hold age stays in the neutral chip, because the pinned tests need "Repuesto" and its age in separate elements.
   - On the phone, drag is gated by CSS (`max-md:hidden` on the grip) rather than by a `matchMedia` store.
   - Cancelling an order toasts "Orden cancelada".

### SUGGESTION

1. Amend the freshness wording in the spec. Done.
2. Open the follow-ups listed in `tasks.md`:
   - a per-card override merge;
   - the "Mis órdenes" filter that stays applied after `onRoster` flips to false;
   - the e2e helper that sends every request as POST.
3. Re-run e2e if the archive is delayed.
