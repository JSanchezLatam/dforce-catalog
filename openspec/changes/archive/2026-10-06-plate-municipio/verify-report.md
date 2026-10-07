# Verify Report: plate-municipio

Verdict: PASS WITH WARNINGS (0 CRITICAL, 2 WARNING, 1 SUGGESTION)
Verified on main @ 92fdfbe (WU1 + WU2 merged).

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 172 files, 2465/2465 passed |
| `npm run lint` | 0 errors, 14 warnings (matches baseline) |
| e2e `vehicle-details` + `vencimientos` on throwaway DB `dforce_verify_pm` (:5433, fresh, migrated 0000-0026) | 2 files, 11/11 passed; DB dropped, confirmed gone |
| Browser check 2.5 (LAN IP, 390/768/1280) | done by orchestrator, not re-run |

## Tasks

All of 1.1-1.7, 2.1-2.5, 3.1 are [x] and match code state (schema column, migration 0026 one-line, validator, gate, route list, form, detail page, due page, queries/service). 3.2 (archive) open by design.

## Scenario coverage

| Scenario | Covering test |
|---|---|
| Admin edits internal fields | `vehicle-details.e2e` "an administrador omitting the keys keeps them, a value sets, and null clears each independently" (pre-existing; form prefill in CustomerForm.test) |
| Month out of range rejected | `validation.test.ts` "rejects renewal month %j with a Spanish error"; e2e "the CHECK constraint rejects a renewal month of 13 and accepts 12" |
| Technician form hides section | `CustomerForm.test.tsx` "a tecnico sees no internal section and sends no internal keys..." and "a tecnico sees no municipio control and sends no key, even when the row carries a value" |
| Municipio trimmed and shown | `validation.test.ts` "trims the plate municipio, turns blank into null..."; `CustomerForm.test.tsx` "an administrador sends the trimmed municipio" (prefills "David"); `vehicles/[vehicleId]/page.test.tsx` "shows the municipio to a viewer with vencimientos.read"; e2e municipio test ("  X " stores "X") |
| Blank municipio becomes null | `validation.test.ts` (same trims test); `CustomerForm.test.tsx` "an administrador blanking the municipio sends an explicit null"; `vehicles.test.ts` "leaves placaMunicipio out of SET when absent, clears it on null..."; e2e (`""` stores null); detail: "omits the row when the vehicle has no municipio" |
| Too long rejected / 80 accepted | `validation.test.ts` "accepts an 80-character municipio and rejects 81 with a Spanish error"; e2e (81 chars gives 400); `CustomerForm.test.tsx` "shows the server's municipio error on the vehicle row" |
| Technician save preserves | `vehicles.test.ts` "leaves placaMunicipio out of SET when absent..."; e2e "keeps the municipio through a tecnico edit..." (real SQL) |
| Technician sending refused | `api/customers/route.test.ts` it.each "refuses a tecnico sending %j with 403..." (`placaMunicipio` string and null); `[id]/route.test.ts` it.each "a municipio" / "a null municipio"; `[id]/vehicles/route.test.ts` "POST answers 400 for everyone that sends %s, null included"; e2e tecnico PATCH gets 403 |
| Municipio never leaks | SENTINEL-MUNICIPIO in: `[id]/vehicles/route.test.ts` "GET omits all three internal keys..." and "POST omits all three..."; `vehicles.test.ts` "drops the internal fields and their values" (toPublicVehiculo); `customers/[id]/page.test.tsx` "hands a viewer without vencimientos.read rows that carry neither internal field"; `service-orders/[id]/page.test.tsx` "never renders the plate renewal month or the insurance expiry..."; `print/page.test.tsx` both "never prints ..." tests. Portal: no portal code reads the column (allowlists) |
| Badge equals rows / clears | `nav-badges.test.ts` "gives an administrador the page's row count..." and "is zero, not missing, when nothing is due..." (unchanged behaviour) |
| Row shows the municipio | `vencimientos/page.test.tsx` "shows the municipio on a plate row, in the table and in the card"; `service.test.ts` "carries the vehicle's municipio onto every row it produces"; `vencimientos.e2e` (real SELECT) |
| Insurance row does not show it | `vencimientos/page.test.tsx` "does not show it on the insurance row of the same vehicle" |
| Row without municipio | `vencimientos/page.test.tsx` "shows no municipio text, null or placeholder when the vehicle has none" |

Uncovered scenarios: none.

## Findings

WARNING 1: No browser-independent test asserts the narrow-screen wrap beyond classes (`min-w-0 break-words`, `flex-wrap`); jsdom matches no layout. Mitigated by the orchestrator's LAN-IP check at 390/768/1280. Not repeatable by this verify.

WARNING 2: Customer portal exposure is proven only by the absence of any portal read of the column plus the allowlist tests; no portal-specific sentinel test exists (the spec names the portal). The design chose "proved by poisoned fixtures" for the listed surfaces only.

SUGGESTION: the leak sentinel on `GET /api/customers/[id]/vehicles` is asserted by the existing "omits all three internal keys" tests; mutation-verification of the allowlists was recorded in tasks but not re-run here.

No CRITICAL issues. Ready for sdd-archive (task 3.2: merge MODIFIED `vehicle-renewals` requirements, not a rename).
