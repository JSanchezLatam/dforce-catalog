# Verify report — workshop-status-board

Date: 2026-10-26. Verdict: **PASS WITH WARNINGS** (0 CRITICAL, 4 WARNING, 4 SUGGESTION). Merged to `main` @ `bd3b075` (#251–#261), byte-identical to the browser-tested tip.

## Evidence

- Gates on the merged tip: `npm test` 3693 passed, `tsc` clean, lint 0/13, full e2e 337 passed on a throwaway database, GGA passed on every PR.
- Browser checks at the LAN IP: the first pass found six defects, all fixed in #261 and re-checked (see `apply-progress.md`, "Browser checks (4.8)").
- Verifier spot-ran the board, auth, layout, tablero, board API, proxy, landing and account suites: 32 files, 324 tests green.

## Compliance

All 12 requirements (11 in `workshop-status-board`, 1 in `user-management`) and 49 scenarios are implemented and covered by unit, e2e or browser evidence.

## WARNING

1. "Cookie follows expiry" [unit] had no test. **Closed by #262**: one test per cookie setter (`loginAction`, `POST /api/login`), each mutation-checked.
2. Task 4.10 unticked although merged — ticked at archive.
3. The WU4 routes e2e and task 1.3's scoping test were written after the code; their RED is the mutation check (retrofit rule).
4. The spec says every API route except the customer poll route answers 403 for `pantalla`; the session-only routes (`/api/account/password`, `/api/logout`, pages `/` and `/change-password`) are deliberately exempt — fixed in the spec at archive.

## SUGGESTION

- The main `user-management` spec mentions a role "list filter" that does not exist.
- One e2e for the `pantalla` forced-password-change path through the proxy and the form (also an owner check).
- `tablero/page.test.tsx` no longer claims "no controls"; `WorkshopBoard.test.tsx` covers it.
- Staff reaching `/tablero` from the sidebar have only the browser back button.

## Owner checks

`pantalla` password login and forced change; a real TV at room distance; a second machine for the stop/restart case.

## Spec text to adjust at archive

1. Full board whitelist: "active assigned technicians" (F1), plus a scenario.
2. Pantalla access: exempt the session-only routes.
3. New requirement: first-load database outage (`proxy.ts` 503 JSON / self-refreshing 503 HTML, never "no session"; `tablero/error.tsx` reloads after 60 s).
4. `design.md` D1 role-error word order and D8 "hace 12 min" are stale (code: spec wording, "12 min").
