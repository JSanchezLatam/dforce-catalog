# Verify report — workshop-agenda

Date: 2026-10-26. Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 6 WARNING, 4 SUGGESTION). Merged to `main` @ `2662bd0` (#264–#281), byte-identical to the browser-tested tip. 14/14 requirements; 73/76 scenarios fully evidenced, 3 partial.

## Evidence

- Gates on the merged tip: `npm test` 3900 passed, `tsc` clean, lint 0/13, full e2e 364 passed on a throwaway database, GGA passed on every PR.
- Three browser passes at the LAN IP (browser zone Asia/Tokyo) with two fix rounds; results in `apply-progress.md`, "Browser checks (WU9)".
- Verifier spot-run: 90 files, 1496 tests green.

## Partial scenarios (task 3.7 replaced by browser checks) — closed by the orchestrator

1. "Unauthenticated": `curl http://192.168.0.7:3000/agenda` without a session → 307 to `/login` (2026-10-26).
2. "Administrador and jefe read the agenda": `/agenda?view=week` with a jefe_taller and an administrador session → 200 with the agenda rendered.
3. "Row cap is disclosed": the query e2e proves 500 rows + `truncated` and the notice is unit-tested; the notice was not seen in a browser (would need 500+ appointments in one range). Open.

## WARNING

1. The partial scenarios above (two now closed).
2. The 500-row notice has no browser proof.
3. No "TDD Cycle Evidence" table; per-WU mutation tables stand in. Disclosed non-RED items: the WU2/WU5/WU6/WU7 e2e files and the WU8 client tests were written after the code and proven by mutation.
4. Placebo `expect(user).toBeTruthy()` in `CustomerQuickForm.test.tsx` — **fixed in the archive PR**; the remaining absence checks go red when the `canWrite` gate is removed (checked).
5. Class-name assertions stand in for 44 px targets (jsdom cannot measure); backed by the browser measurements.
6. Spec drift fixed at archive: the phone month view shows counts only (chips and "+N más" from `md` up); the duplicate lookup uses `status=all`.

## SUGGESTION

- Page path is `src/app/(app)/agenda/`, not `src/app/agenda/`.
- Stale assumption lines in the spec.
- Browser passes ran from the server's LAN IP, not a second machine.
- `appointment_at` has no index; plan unmeasured.

## Archive adjustments

1. New main spec `workshop-agenda` (with the W6 and path fixes).
2. `service-orders`: the optional `expectedStatus` guard on `PATCH /api/service-orders/[id]` (status and field paths) in "Order Editing Is Gated by Role and Current Status".
3. `service-orders` R23: picker result rows stack the identifier under the name in one wrapping cell with a "Cliente" header.
4. Sidebar "Taller" group: no main spec states nav groups; nothing else to change.
