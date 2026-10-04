# Tasks: Vehicle Details and Renewals

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,560 total: PR1 ~400, PR2 ~150, PR3 ~350, PR4 ~250, PR5 ~410; migration SQL and snapshots excluded |
| 400-line budget risk | Medium (PR1 and PR5 sit at the limit; tests dominate) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 → PR5, each based on the previous branch; PR1 may split 1a server / 1b form, PR5 may split `message.ts` first |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved 2026-10-04)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Vehicle columns, validation, tri-state save, 403 gate, public mapper, form, vehicle detail | PR 1 (base: main) | `npx vitest run src/modules/customers src/app/api/customers src/modules/auth` | e2e on throwaway DB; LAN-IP browser check | Revert PR 1; migration 0021 is additive |
| 2 | Order detail and print sheet show new fields, never internal ones | PR 2 (base: PR 1 branch) | `npx vitest run src/modules/service-orders "src/app/(app)/service-orders"` | Print PREVIEW at LAN IP | Revert PR 2; nothing else depends on it |
| 3 | `vehiculo_contacto`, due rules, queries, contact route | PR 3 (base: PR 2 branch) | `npx vitest run src/modules/vencimientos src/shared/datetime src/app/api/vencimientos` | e2e on throwaway DB | Revert PR 3; table holds only marks |
| 4 | Page (list only), nav item, sidebar badge | PR 4 (base: PR 3 branch) | `npx vitest run "src/app/(app)/vencimientos" src/modules/layout` | LAN-IP browser check, phone width and collapsed rail | Revert PR 4; data layer stays |
| 5 | Message builder and Contactar dialog | PR 5 (base: PR 4 branch) | `npx vitest run src/modules/vencimientos` | `wa.me` link from a second machine over HTTP | Revert PR 5; list keeps its plain Contactado button |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red). Fixtures must match the wire. Migrations come from `drizzle-kit generate --name <n>`, never hand-written SQL; the workshop must run `standalone.ps1` to apply them. Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 14 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous PR's branch (auto-detect resolves to `main`).

## WU1: Columns, validation, preservation, gate (PR 1)

- [x] 1.1 RED `route-guards.test.ts`: `POST /api/customers` and `PATCH /api/customers/[id]` list `vencimientos.read`. GREEN: add the Action to `policy.ts` (administrador true, tecnico false) and the rows.
- [x] 1.2 `schema.ts`: add `chasis`, `color_primario`, `color_secundario`, `estilo`, `numero_unidad` text, pgEnum `vehiculo_motor`, `placa_renovacion_mes` smallint with `check()` 1..12, `seguro_vence` `date({ mode: "string" })`. Run `drizzle-kit generate --name vehiculo_details` (0021); confirm the CHECK is in the SQL.
- [x] 1.3 New client-safe `vehicle-options.ts` (`ESTILO_OPTIONS`, `MOTOR_LABEL`, Spanish month names).
- [x] 1.4 RED `validation.test.ts`: estilo "Cohete" and motor "diesel" rejected; month 0 and 13 rejected with Spanish errors; valid values pass. GREEN `validation.ts`.
- [x] 1.5 RED `vehicles.test.ts` tri-state: a plan without internal keys leaves them out of SET; `null` clears; a value sets; public columns keep `?? null`. GREEN `applyVehiculoPlan`.
- [x] 1.6 RED `toPublicVehiculo`: sentinel internal values absent from the allowlist object. GREEN `vehicles.ts`, used by GET and POST `/vehicles`.
- [x] 1.7 RED route tests: tecnico sending either key (including `null`) on POST/PATCH `customers` gets 403 and nothing persists; `/vehicles` POST answers 400 for everyone (`COLLECTION_ONLY_FIELDS`). GREEN `sendsInternalVehiculoFields` before validation.
- [x] 1.8 RED e2e `src/e2e/vehicle-details.e2e.test.ts` (throwaway DB, never the dev DB): tecnico PATCH keeps stored values, admin `null` clears, `seguro_vence` round-trips as a string, CHECK rejects 13. GREEN: fix any real-SQL defect.
- [x] 1.9 RED `CustomerForm` tests: tecnico sees no internal section and sends no internal keys; admin sees both and they round-trip; toast convention unchanged. GREEN `CustomerForm.tsx`, `CustomerFormTrigger.tsx` (`canEditInternal`).
- [x] 1.10 RED page tests: `customers/[id]/page.tsx` passes `toPublicVehiculo` rows to the trigger for a viewer without `vencimientos.read`; vehicle detail page shows internal fields for admin only. GREEN both pages and the `ServiceOrderForm.tsx` type.
- [x] 1.11 44x44 on new form controls (`min-h-11`); no test asserts it, so measure in 1.13. (PR 1b adds no new action control: the new fields are native selects and inputs at the form's existing `h-8` field height, which is the standing field exception. Confirm in 1.13.)
- [x] 1.12 Mutation-verify 1.1-1.10 by name (1.1-1.8 done in PR 1a; 1.9-1.10 done in PR 1b) (restore `?? null`, drop the 403, return the whole row).
- [x] 1.13 Browser at `http://<LAN-ip>:3000` as admin and as tecnico: the customer page crosses a Server→Client boundary (`CustomerFormTrigger`); read the console for RSC and hydration errors; measure targets.

## WU2: Order detail and print sheet (PR 2)

- [x] 2.1 RED order detail test: chasis, colors, estilo, motor show; unit label absent when empty, present when set; poisoned vehicle with sentinel renewal month and insurance expiry renders neither. GREEN order detail page (named-field allowlist).
- [x] 2.2 RED print page test: same fields beside placa, marca, modelo, año; sentinels absent. GREEN print page.
- [x] 2.3 Mutation-verify 2.1-2.2 (render the whole vehicle row, sentinel test goes red).
- [ ] 2.4 Print PREVIEW at the LAN IP, not the page: with the extra rows the signature must stay on page 1.

## WU3: Due module and contact mark (PR 3)

- [ ] 3.1 RED `shared/datetime.test.ts`: `toWorkshopDateKey(2026-10-01T03:00:00Z)` is `2026-09-30`. GREEN `toWorkshopDateKey` (`en-CA`, `America/Panama`).
- [ ] 3.2 RED `due.test.ts`: Oct gives 10 and 11 due, 9 and 8 overdue, 12 and 7 not (month 3 waits for 2027-03); Jan 2027 gives 11 and 12 overdue as 2026 periods, 10 not; Dec gives 12 and 1; Nov→Dec; insurance 2026-11-03 due, 2026-11-04 not, 2026-09-01 overdue; contacted key hides; new expiry or next year resurfaces; no month never due. GREEN `vencimientos/due.ts` (string comparison, injected `todayKey`).
- [ ] 3.3 `schema.ts`: `vehiculo_contacto` with pgEnum `vencimiento_kind`, composite PK, cascade, `contacted_by` set null. `drizzle-kit generate --name vehiculo_contacto` (0022).
- [ ] 3.4 RED `vencimientos.contact` in `policy.ts` and a guard row for `POST /api/vencimientos/contact`. GREEN.
- [ ] 3.5 RED service tests (injected seam): insert uses `onConflictDoNothing`; `getDueVencimientos(now)` returns the badge count equal to its rows. GREEN `queries.ts`, `service.ts`. Amend the `vehicles.ts` header.
- [ ] 3.6 RED route tests: no `vencimientos.contact` 403; bad `periodKey` for its kind 400; missing vehicle 404; duplicate 200. GREEN `src/app/api/vencimientos/contact/route.ts`.
- [ ] 3.7 RED e2e `src/e2e/vencimientos.e2e.test.ts`: candidates exclude deactivated vehicles and customers; a double insert leaves one row; a contacted item drops out. GREEN: fix real-SQL defects.
- [ ] 3.8 Mutation-verify 3.1-3.7 (drop `onConflictDoNothing`, shift the Dec wrap, parse a `Date`).

## WU4: Page, nav item, badge (PR 4)

- [ ] 4.1 RED `nav-items.test.ts`: item `/vencimientos` only with `vencimientos.read`; `getNavGroups(user, {"/vencimientos": n})` sets `badge`. GREEN `nav-items.ts`.
- [ ] 4.2 RED page tests: tecnico refused; list shows customer, plate, kind, month or date, overdue; plain "Marcar como contactado" button (44x44) calls the contact route, toast above `router.refresh()`, both below the `try/catch`; copy "1 vencimiento contactado" in the singular. GREEN `(app)/vencimientos/page.tsx`.
- [ ] 4.3 RED badge: layout count equals the page's rows; hidden at 0; technician gets none; collapsed rail shows the aria-hidden dot and tooltip `Vencimientos próximos (n)`; sr-only count in the link. GREEN `app-sidebar.tsx`, `layout.tsx`.
- [ ] 4.4 Mutation-verify 4.1-4.3 (count from a different source, drop the gate).
- [ ] 4.5 Browser at the LAN IP: phone width, collapsed rail, RSC boundary, console clean; the page needs enough rows to expose volume bugs.

## WU5: Message builder and Contactar dialog (PR 5)

- [ ] 5.1 RED `message.test.ts`: price 45 gives "corresponde en noviembre de 2026" and "por B/. 45.00."; empty or `NaN` price has no "B/."; overdue plate "correspondía en"; insurance "venció el 01/09/2026" vs "vence el 20/10/2026"; null workshop fields drop their fragments, no "null"; no make or model reads "su vehículo (ABC123)"; `waMeUrl` encodes spaces, accents, `/`, `.`. GREEN `vencimientos/message.ts`.
- [ ] 5.2 RED dialog tests: preview updates as the price is typed; WhatsApp `href` is `https://wa.me/50761111111?text=…` with `target="_blank"`; clicking sends no request and no toast; opt-out disables it with "El cliente pidió no recibir WhatsApp" and "Marcar como contactado" still works; refused phone shows "El teléfono del cliente no es un celular"; "Correo" disabled "Próximamente". GREEN `ContactDialog.tsx` replacing the plain button.
- [ ] 5.3 RED page wiring: row props contain only the design's allowlist; opt-out flags, raw phone and `workshop_config` columns absent (poisoned fixture). GREEN page: `toE164` server-side, `getWorkshopConfig`.
- [ ] 5.4 44x44 on dialog buttons and the price input; success toast on mark.
- [ ] 5.5 Mutation-verify 5.1-5.3 (drop the opt-out check, mark on open, concatenate without encoding).
- [ ] 5.6 Browser from another machine over HTTP: the link opens `wa.me` with the message intact; dialog is a portal, so read the console for hydration errors.

## Spec archive notes

- [ ] 6.1 At archive, merge the three delta specs; `vehicle-renewals` is a new capability, the other two add requirements and one MODIFIED requirement each (not renames).
- [ ] 6.2 Follow-ups, not in scope: poll for cross-machine badge staleness; email sending.
