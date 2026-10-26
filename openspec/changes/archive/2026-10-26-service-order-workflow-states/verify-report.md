# Verify report — service-order-workflow-states

Date: 2026-10-26. Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 3 WARNING, 3 SUGGESTION).

Merged to `main` @ `07a34d3` (#245–#249). `main` is byte-identical to the tested `feat/order-workflow-states-wu4` tip.

## Evidence

- Gates on the merged tip: `npm test` 3563 passed, `npx tsc --noEmit` clean, `npm run lint` 0 errors / 13 warnings, e2e 311 passed on a throwaway database.
- Browser checks (task 4.8) passed at the LAN IP on tablet and phone; results are in the PR #249 body.
- Verifier re-ran the service-orders, portal-sync, metrics, reminders, service-orders API/page and StatusBadge suites: 62 files, 1421 tests green.

## Compliance

Every requirement in `specs/*/spec.md` maps to implementation and tests: R20 creation, R21 transitions, reception photos, order editing gate, bulk status, order assignment, booked order without vehicle/category, vehicle and category set while booked, on-hold reason, appointment reminder only while booked, status labels/badge/filter, status action toasts, work-lines writers and "Mi parte lista", portal-sync whitelist and sync triggers, status history, metrics backlog, enum column badges. Tasks 1.1–4.8 match the code. Task 4.9 (pre-deploy counts on the workshop database) is open by design.

## WARNING

1. Two `[e2e]` scenarios have no real-SQL test: "Assigning on hold or in progress does not change status" (unit only, `assignments.test.ts:52,127`) and "Deactivating the only technician leaves diagnosing" (no test; holds because nothing on the deactivation path writes status).
2. Tasks 2.9, 3.9 and 4.10 were unchecked although merged.
3. The 403 body in `src/app/api/service-orders/[id]/route.ts` says "cerrar, cancelar o devolver" but now also covers hold, resume and start.

## SUGGESTION

- Update that 403 copy to name hold, resume and start.
- "Retry stays idempotent" is tagged `[unit]` but proven in `reminder-guard.e2e.test.ts:103`.
- Retag the two warning-1 scenarios, or add their e2e tests as a follow-up.

## Spec text to adjust at archive

1. Bulk requirement: replace `getAllowedTransitions` with `getManualTransitions` / `allowedTransitionsForAll` (the old name does not exist in `src`).
2. Bulk requirement: receiving (`booked → open`) is not offered in bulk (`BULK_EXCLUDED = {on_hold, open}`).
3. Status action toasts: the copy list also includes "Orden completada" and "Orden cancelada".
4. `tasks.md`: 4.4's toast lives in `ServiceOrderFormTrigger.tsx`; 4.5's e2e file is `reminder-guard.e2e.test.ts`.
