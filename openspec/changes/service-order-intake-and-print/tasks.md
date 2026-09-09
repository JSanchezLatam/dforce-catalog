# Tasks: Service Order Intake and Print

## Review Workload Forecast

The proposal forecast three work units (~750 lines); D11 (the edit gate) makes
a fourth.

**Correction to an earlier draft of this section.** It claimed D11 was absent
from `design.md`'s File Changes table. That is false: the table assigns unit
**`0`** to `edit-policy.ts`, its test, the detail-page mount and the `PATCH`
route change, and the design says "WU0 lands first". This file renumbers that
WU0 to **WU4** and the "Delivery order" section below is the live plan —
1 → 2 → 4 → 3. Read the numbering here, not in `design.md`.

The renumbering, not the premise, is what stands: folding the gate into WU1
would mix "customer/vehicle intake UX" with "role/status authorization" in one
PR and push WU1 from ~250 to ~500+ lines; it has no functional dependency on
WU2 (vehicle insert) and only a soft one on WU1 (the edit form inherits the
textarea). It ships as its own unit, after WU3, because both touch the same
detail-page header file.

| Field | Value |
|---|---|
| Estimated changed lines | ~1,030 (WU1 ~250, WU2 ~300, WU3 ~200, WU4 ~280) |
| Review budget (this session) | 800 lines per PR |
| 800-line budget risk | Low per unit, Medium-High total across the chain |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain (cached at session start) |
| Chain strategy | feature-branch-chain, matching this repo's convention |

Decision needed before apply: No (auto-chain, cached at session start)
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
800-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Intake form: picker clear-on-select + deselect (D6); textarea + label (spec "Description Field and Appointment Label"); parts section removed; `observaciones` through form → route → `createOrder` (D7) | PR 1 (base: tracker) | `npx vitest run CustomerPicker ServiceOrderForm service.test` | Browser check, both themes — create-order dialog | Reverting restores the parts cart and single-line description; no DB rows depend on it |
| 2 | Inline vehicle creation: `POST /api/customers/[id]/vehicles` + `createVehiculo` (D1/D2/D3), `VehicleQuickForm` (D4), year-string guard (D10) | PR 2 (base: PR 1) | `npx vitest run vehicles.test route.test` + `npm run test:e2e -- full-flow` | **e2e is required, not optional** — real Postgres, customer with 3+ active vehicles | Reverting removes the `POST` route; inserted vehicles are ordinary rows and survive the revert |
| 3 | Printed order: print page, `PrintButton`, `@media print` shell rule, Imprimir link (D8/D9) | PR 3 (base: PR 4 — see Delivery order) | `npx vitest run print` | **N/A by test — real browser print preview is the verification** (jsdom cannot see `@media print` or `window.print()`) | Reverting removes the print route, the button and the CSS block; zero new SQL to unwind |
| 4 | Edit entry point gated by role + status: `edit-policy.ts`, detail-page mount, `PATCH` route gate (D11) | PR 4 (base: PR 2 — see Delivery order) | `npx vitest run edit-policy "service-orders/[id]"` | Browser check — dialog opens on a real order across roles/statuses (RSC mount, invisible to jsdom) | Reverting removes the edit control and the route's status check; `updateOrder`/the PATCH route stay exactly as they are today |

```
tracker (draft, no-merge)
  └── 1 intake ── 2 vehicle insert ── 4 edit gate ── 3 print
```

The chain above is the LANDING order (1 → 2 → 4 → 3), which is what a PR base
has to follow. The unit numbers are phase numbers and deliberately do not run
in sequence — see "Delivery order" below for why.

## Delivery order — by what it unblocks, not by phase number

**Ship in the order 1 → 2 → 4 → 3.** The phases below keep their numbers; only
the landing order differs, and it differs deliberately.

The tasks phase ordered Phase 4 last because it and Phase 3 both edit the
detail page's header, so a linear chain avoids a rebase. That is a convenience
argument, and it loses to what each unit unblocks:

- **Phase 2 is the hardest block.** Only 2 of 370 customers have a vehicle and
  `orden_servicio.vehiculoId` is `NOT NULL`, so an order cannot be created for
  the other 368 at all. Until this lands, most of the app's customers have no
  path to a service order.
- **Phase 4 is the reported defect.** The owner asked why he cannot edit
  `hallazgos`/`recomendaciones`/`observaciones`; the answer is that no entry
  point exists. Every day this waits is a day those fields are unreachable
  after creation.
- **Phase 3 is new capability, not a repair.** The printed order has never
  existed, so nothing regresses by it landing last.

Phase 3 therefore rebases on Phase 4's header change rather than the reverse.
Same conflict, opposite direction, and the direction is chosen by which unit
the owner is waiting on.

## Gates, every unit

- `npm test` (run alone — this machine produces phantom timeouts when suites
  overlap) and `npx tsc --noEmit` clean before opening that unit's PR.
- `gga run --pr-mode --diff-only` (`GGA_TIMEOUT=900`, pin `PR_BASE_BRANCH` to
  the previous unit's branch — `--pr-mode` auto-detect resolves to `main` on
  a chained branch).
- `gentle-ai review status --contract gentle-ai.review-integration/v2 --agent
  <runtime> --next-transition` before delivery.
- Every task below marked **mutation-verify** ends with a `diff` proving the
  swap actually landed before trusting the red result, then a second `diff`
  after reverting. `sd` exits 0 on no match and no-ops on multiline JSX —
  prefer Python line edits over regex there.
- Every unit below gets a **browser check with the console open** — WU3's is
  a real print preview, not a substitute test; WU4's is an RSC mount jsdom
  cannot see.

---

## Phase 1 — Intake form (service-orders spec: *Customer Selection Clear and
Explicit Deselect*, *Description Field and Appointment Label*, R20, *Category
and Completion Notes Editing*; design D6, D7)

- [x] 1.1 RED (jsdom) `CustomerPicker.test.tsx` — selecting a customer clears
  `term`, `results`, `total`, `relaxedFrom` and `hasSearched` (zero tests
  today click "Seleccionar" and then assert search-box state). Confirm it
  fails against current `handleSelect` (`CustomerPicker.tsx:109-112`).
- [x] 1.2 GREEN — `handleSelect` clears all five.
- [x] 1.3 RED (jsdom) — the selected-customer banner (`:120-124`) renders an
  explicit deselect control at `min-h-11 min-w-11`, separate from picking a
  different customer; edit mode renders none (spec Scenarios "Deselect
  control meets the hit-target floor", "Edit mode offers no deselect").
- [x] 1.4 GREEN — add the control and an `onDeselect?: () => void` prop,
  create-mode only.
- [x] 1.5 RED (jsdom) `ServiceOrderForm.test.tsx` — deselecting clears
  `vehiculoId` (`ServiceOrderForm.tsx:108`) (spec Scenario "Deselect clears
  the chosen vehicle").
- [x] 1.6 GREEN — wire `onDeselect` to `setVehiculoId("")`.
- [x] 1.7 RED/GREEN — `Descripción` renders as a `<textarea>` using the
  `NATIVE_FIELD` class (`:38`), on both the create and edit forms (spec
  Scenario "Descripción is multi-line").
- [x] 1.8 RED/GREEN — the appointment label reads exactly
  `Fecha y hora de inicio`; the field stays `datetime-local`,
  `toDatetimeLocal` untouched (spec Scenario "Appointment label reads the new
  text").
- [x] 1.9 GREEN — delete the parts cart section (`:502-582`, `!isEdit` only);
  confirm no leftover cart references remain in `ServiceOrderForm.test.tsx`
  (proposal states there are zero today — verify, don't assume).
- [x] 1.10 RED (node) `service.test.ts` — enter at the seam boundary with a
  JSON round trip (`JSON.parse(JSON.stringify(formState))`, never a
  hand-typed literal, per D10's shape): `observaciones` reaches the insert
  seam; `items`/`ordenServicioItem` insert is unreachable (gate on
  `items.length > 0` has no caller left).
- [x] 1.11 GREEN — `CreateOrdenServicioInput` (`service.ts:120-128`) drops
  `items`, adds `observaciones?: string | null` (D7 interfaces block); form
  and `POST /api/service-orders` (`route.ts`) stop forwarding `items`, start
  forwarding `observaciones`.
- [x] 1.12 RED/GREEN — spec Scenarios "Hallazgos and recomendaciones stay
  rejected at creation" and "Observaciones stored, hallazgos rejected, from
  the same payload": a create payload carrying `hallazgos`/`recomendaciones`
  is ignored or rejected; `observaciones` persists from the same payload.
- [x] 1.13 RED/GREEN — spec Scenario "A new order's Piezas card always shows
  its empty state": confirm `[id]/page.tsx`'s Piezas card renders empty for
  an order created after this ships (existing empty-state path, new
  assertion).
- [x] 1.14 Confirm spec Scenario "Customer with zero active vehicles blocks
  submission" still passes unchanged after the parts-section removal.
- [x] 1.15 **Mutation-verify 1.10** — comment out the route's forwarding of
  `observaciones`; confirm the test goes red **by name**. `diff` to confirm
  the removal landed, then revert and confirm green.
- [x] 1.16 `diff` `CustomerPicker.tsx`, `ServiceOrderForm.tsx`, `service.ts`,
  `route.ts` and every touched test before trusting 1.1–1.15.
- [x] 1.17 Seed one customer with an active vehicle in the dev database if
  none suitable exists (only 2/370 customers currently have one) —
  prerequisite for 1.18, not an assumption.
- [x] 1.18 **Browser check, both themes, 0 console errors**: create-order
  dialog — select a customer and confirm the search box/results clear;
  deselect and confirm the vehicle selection resets; confirm the textarea,
  the new label text, no parts section; fill `observaciones` and save;
  confirm the order persists.
- [x] 1.19 `npm test` (alone) and `npx tsc --noEmit` clean.

## Phase 2 — Inline vehicle creation (customer-management spec: *Single
Vehicle Insert Without Reconcile*; design D1, D2, D3, D4, D10)

- [x] 2.1 RED (node) `customers/vehicles.test.ts` — `createVehiculo` against
  a fake `TxLike` seeded with **3 existing active vehicles**: assert
  **exactly one `insert` call and zero `update` calls** (D2, the guard that
  runs on every commit).
- [x] 2.2 GREEN — `createVehiculo(clienteId, input, deps?)` in
  `customers/vehicles.ts` (sole owner of the `vehiculo` table), a single
  insert. Signature per design's Interfaces block; **never** calls
  `planVehiculoReconcile`/`applyVehiculoPlan`.
- [x] 2.3 **Mutation-verify 2.1 — the binding requirement.** Temporarily
  route the same input through `planVehiculoReconcile` + `applyVehiculoPlan`
  instead. Confirm the test goes red **by name** (`applyVehiculoPlan` issues
  an `UPDATE` per deactivation, `vehicles.ts:244`). `diff` to confirm the
  swap landed, then revert and confirm green again.
- [x] 2.4 RED (node) — a body with `year: "2019"` (string) is **rejected**
  with 400 `{ errors: { year: "Año inválido" } }`, not silently dropped.
  This is D10's explicit ruling, not a fresh call this phase is making:
  `validateVehiculoInput` (`validation.ts:126`) keeps `year` only when
  `typeof value.year === "number"`, so an unguarded route would drop it
  silently — the identical defect class `POST /api/service-orders` already
  shipped once (D10).
- [x] 2.5 GREEN — the route guards `year` explicitly before calling
  `validateVehiculoInput`, matching the `NULLABLE_TEXT_FIELDS` guard shape at
  `service-orders/[id]/route.ts:46-58`.
- [x] 2.6 RED (node) `customers/[id]/vehicles/route.test.ts` (new) — POST
  rejects a body carrying `id`, `deleted` or `deactivated` with 400 rather
  than dropping them (D1's trust boundary — `validateVehiculoInput`'s return
  type is collection-shaped and permits `plate: ""` when `deleted === true`).
- [x] 2.7 GREEN — `handleCreateVehiculo` accepts only `plate`, `make`,
  `model`, `year`; reuses `validateVehiculoInput` on that narrowed shape.
- [x] 2.8 RED/GREEN — unknown `clienteId` → 404 `not_found`; deactivated
  `cliente` → 409 `cliente_deactivated` (customer-management spec Scenario
  "Deactivated customer cannot receive a new vehicle"), both from one
  `getClienteById` call before the insert (D3).
- [x] 2.9 RED/GREEN — missing `customers.write` → 403 before any database
  work (spec Scenario "Insert requires customers.write").
- [x] 2.10 RED/GREEN — plate required when any other vehicle field is set,
  reusing the existing per-vehicle rule (spec Scenario "Plate required when
  any other vehicle field is set") — not a second copy of the rule.
- [x] 2.11 Add `POST: "customers.write"` to the `ROUTE_GUARDS` entry for
  `/api/customers/[id]/vehicles` (D3); update `route-guards.test.ts`.
- [x] 2.12 Create `src/modules/customers/VehicleQuickForm.tsx` — `placa`,
  `marca`, `modelo`, `año` only, **no** consent fields, **not**
  `CustomerForm` (D4). Coerces `year` with `Number()` before POST, mirroring
  `CustomerForm`'s existing coercion (D10). Props: `clienteId`, `onCreated`,
  `onCancel` per the Interfaces block.
- [x] 2.13 RED (jsdom) — pin the consent trap shut: assert the request body
  `VehicleQuickForm` sends carries **no** `whatsappOptOut`, `emailOptOut`, or
  any other `cliente` field (D4). **Mutation-verify**: add a stray consent
  field to the payload build and confirm this test catches it **by name**;
  `diff`, then revert.
- [x] 2.14 GREEN — wire `VehicleQuickForm` into `ServiceOrderForm` at
  `VEHICLES_EMPTY_HINT_ID`, gated on `customers.write` (same rule as "Crear
  cliente nuevo"); on success, select the new vehicle and bump
  `vehiclesRetry`.
- [x] 2.15 `diff` every file touched in this unit before trusting 2.1–2.14.
- [x] 2.16 Seed a customer with **3+ active vehicles** in a throwaway
  Postgres on the `proyectocatalogo-db-1` server (`:5433`) — explicit
  prerequisite for 2.17, never point it at `dforce_catalog`.
- [x] 2.17 **e2e (real Postgres, excluded from `npm test`)** — new describe
  in `src/e2e/full-flow.e2e.test.ts`: 3 active vehicles + 1 insert through
  the route → **4 active**, none deactivated; `whatsappOptOut`/
  `emailOptOut` byte-identical pre/post. This is the **only** real-SQL proof
  for D1/D2's binding claim, and it only runs when someone runs it — say so
  plainly rather than treating a green `npm test` as coverage of it.
- [x] 2.18 **Browser check, both themes, 0 console errors**: order-creation
  dialog for a customer with zero vehicles — add one inline without leaving
  the dialog, confirm it's selected and the order saves.
- [x] 2.19 `npm test` (alone) and `npx tsc --noEmit` clean.

### WU2 verification record — what was actually run, and where

Written because a ticked box is a claim. AGENTS.md: a green `npm test` proves
**zero** real-SQL coverage of the INSERT this unit exists for.

| Task | Evidence |
|---|---|
| 2.3 | Re-run independently of the implementing agent. `createVehiculo` rewritten to `planVehiculoReconcile` + `applyVehiculoPlan`; `vehicles.test.ts` went red on 3 tests **by name**, e2e red at `expected 1 to have a length of 4`. Restored byte-identically (`diff` clean). |
| 2.16 | Throwaway `dforce_wu2_fresh` on `:5433`, provisioned with `drizzle-kit migrate`. **`drizzle-kit push` poisons it** — migration 0000 then collides with existing tables and `drizzle-kit migrate` exits 1 printing no error, which reads as a broken e2e. Use `migrate`, on a virgin database, every run. |
| 2.17 | `DATABASE_URL=… npm run test:e2e` → **49/49 passed**. The new describe was appended after the catalog-generation one, which ends the shared pool in `afterAll`; it is now placed before it (the file header already warned about this). |
| 2.18 | Worktree preview on `:3021` against throwaway `dforce_wu2_ui`, dark **and** light, 0 console errors. Customer with no vehicles → "Agregar vehículo" → saved → auto-selected → order saved. Postgres confirms 1 vehicle (`year = 2019`, a number), **0 extra orders** (the nested-form fix holds outside jsdom), and the other customer's 3 vehicles still active. Next 16 refuses a second `next dev` in the same directory, and blocks dev chunks from a cross-origin host — `127.0.0.1` needs `allowedDevOrigins` (set in the throwaway worktree only, never committed). |
| 2.19 | `npm test` 1519/1519 · `npx tsc --noEmit` clean · `npm run lint` 0 errors / 15 warnings (the documented baseline). |

Post-GGA in this unit, beyond the task list: the deterministic 409
(`cliente_deactivated`) no longer falls through to "Intentalo de nuevo" — the
route answers `{ error }`, not `{ errors }`, so reading only `body.errors`
buried it. The dead `onCancel` prop was dropped (design's Interfaces block
still lists it; `DialogClose` already closes the dialog and the sole caller
passed a no-op). And WU1's `"Fecha y hora de inicio"` on the detail page is
now pinned by a test, mutation-verified against `"Cita"`.

## Phase 3 — Printed order (service-orders spec: *Printable Work Order*;
design D8, D9)

- [ ] 3.1 Create `src/app/(app)/service-orders/[id]/print/page.tsx` — Server
  Component, `requireSessionFromHeaders()` + `can(user,
  "service-orders.read")`, reuses `getOrdenServicioById` +
  `getClienteById` — the same two queries `[id]/page.tsx:76-83` already
  makes. Zero new SQL.
- [ ] 3.2 RED (jsdom) print `page.test.tsx` — renders cliente
  (nombre, teléfono), vehículo (placa, marca, modelo, año), categoría, fecha
  y hora de inicio, descripción, observaciones for a fully-set order (spec
  Scenario "Printed page carries the order's data").
- [ ] 3.3 GREEN — implement the fields.
- [ ] 3.4 RED/GREEN — an empty ruled block headed "Trabajo realizado /
  Hallazgos" with a signature line renders **regardless** of whether
  `hallazgos`/`recomendaciones` are set on the order — assert it is never
  populated from either (spec Scenario "Printed page reserves handwriting
  space"; D9 — this is layout, not data).
- [ ] 3.5 RED/GREEN — a session without `service-orders.read` is refused
  exactly as any other order-read route (spec Scenario "Print view enforces
  the same read gate").
- [ ] 3.6 Create `src/modules/service-orders/PrintButton.tsx` — `"use
  client"`, zero props, `<button onClick={() => window.print()}
  className="print:hidden">`. No `useEffect`, no `typeof document` gate
  (D8 — AGENTS.md names that gate React's documented cause #1 for a
  hydration mismatch).
- [ ] 3.7 Add `"/service-orders/[id]/print": { GET: "service-orders.read" }`
  to `ROUTE_GUARDS`; update `route-guards.test.ts`.
- [ ] 3.8 Add "Imprimir" `<Link>` on `service-orders/[id]/page.tsx`, styled
  with `buttonVariants` on the `Link` (not `<Button render={<Link/>}>`, per
  `customers/page.tsx`'s documented reason) at `min-h-11 min-w-11` (spec
  Scenario "Imprimir navigates to the print view").
- [ ] 3.9 Add one `@media print` block to `src/app/globals.css` hiding
  `[data-slot="sidebar"]`/`"sidebar-trigger"`/`"sidebar-rail"` and zeroing
  `[data-slot="sidebar-inset"]` margin/shadow — selectors verbatim from
  `components/ui/sidebar.tsx` (D8). First `@media print` block in the repo.
- [ ] 3.10 `diff` every touched file before trusting 3.2–3.9.
- [ ] 3.11 Seed at least one order with a customer, vehicle, `description`
  and `observaciones` (depends on WU1's create path and WU2's vehicle
  insert already shipping) — `/service-orders` has 0 rows today.
- [ ] 3.12 **Real print preview, console open — the only verification this
  unit has.** jsdom cannot see `@media print` or `window.print()`; no
  assertion can be written for page breaks, margins, or whether the sidebar
  actually vanished. Open a seeded order, click Imprimir, confirm: one page;
  sidebar, breadcrumb, `OrderStatusControls`, Piezas and Recordatorios cards
  all absent; cliente/vehículo/categoría/fecha/descripción/observaciones
  present; the ruled block and signature line fit; Imprimir measures
  ≥44×44; no console error (RSC refusals are invisible to jsdom).
- [ ] 3.13 `npm test` (alone) and `npx tsc --noEmit` clean.

## Phase 4 — Edit entry point, gated by role and current status (service-orders
spec: *Order Editing Is Gated by Role and Current Status*; design D11)

- [ ] 4.1 RED (node, DB-free) `edit-policy.test.ts` — table-driven over all
  eight `(role, status)` combinations from the spec's truth table
  (`administrador`/`tecnico` × `open`/`in_progress`/`done`/`cancelled`).
- [ ] 4.2 GREEN — create `src/modules/service-orders/edit-policy.ts`:
  `canEditOrderFields(role, status): boolean`. No `policy.ts` change, no new
  `Action` — this predicate is the fine-grained gate that runs after the
  existing coarse `service-orders.write` check.
- [ ] 4.3 **Mutation-verify 4.1** — flip the `open`/`tecnico` cell (or any
  single cell) and confirm the test goes red **by name**. `diff` to confirm
  the flip landed, then revert and confirm green.
- [ ] 4.4 RED (node) `[id]/route.test.ts` — three cases, JSON-round-tripped
  bodies, asserting what the seam **received**, not that the call resolved
  (D10's shape): `tecnico` + `open` → 403
  `{ errors: { form: "Solo un administrador puede editar una orden abierta." } }`;
  `administrador` + `done` → 409
  `{ errors: { form: "No se puede editar una orden completada o cancelada." } }`;
  a body claiming `status: "in_progress"` over a **stored** `done` still →
  409 — the gate reads status from `deps.getById ?? getOrdenServicioById`,
  never `body.status` (spec Scenario "The route reads status from the
  record, not from the body").
- [ ] 4.5 GREEN — in `handleUpdateOrdenServicio`, keep
  `can(user, "service-orders.write")` as-is; **in the field-patch branch
  only** (the `body.status` branch still routes to `transitionOrder`
  untouched), resolve the current order through the existing `getById` seam
  and evaluate `canEditOrderFields` against `current.orden.status` before
  calling `updateOrder`.
- [ ] 4.6 RED/GREEN — `tecnico` + `in_progress` → 200 and the update seam
  receives `hallazgos` as sent (spec Scenario "A permitted patch still
  saves").
- [ ] 4.7 RED/GREEN — order not found → 404 `not_found` (existing
  `OrdenServicioNotFoundError` mapping, confirm the new gate doesn't change
  it).
- [ ] 4.8 RED (jsdom) `service-orders/[id]/page.test.tsx` — mount
  `ServiceOrderFormTrigger` with `order={orden}`, gated server-side by
  `canEditOrderFields(user.role, orden.status)` (a boolean only crosses to
  the client trigger — no function, no RSC hazard). Assert: control present
  for `administrador` on `open`, absent for `tecnico` on `open`, present for
  both on `in_progress`, absent for both on `done`/`cancelled`. Assert the
  Spanish trigger label; `render(await Page({ params }))` in the existing
  jsdom project.
- [ ] 4.9 GREEN — mount the trigger at `min-h-11 min-w-11` beside
  `OrderStatusControls` in the detail-page header.
- [ ] 4.10 `diff` `edit-policy.ts` + its test, `[id]/route.ts` + its test,
  `service-orders/[id]/page.tsx` + its test before trusting 4.1–4.9.
- [ ] 4.11 Seed orders across statuses (`open`, `in_progress`,
  `done`/`cancelled`) and confirm access to an `administrador` and a
  `tecnico` session for 4.12 — none of the required combinations exist in
  the dev database today.
- [ ] 4.12 **Browser check, console open** — jsdom cannot see an RSC
  refusal, and this is a new client mount on server-rendered data: as
  `administrador`, open a seeded `open`-status order and confirm the control
  renders and opens the form pre-filled; as `tecnico` on the same order,
  confirm no control renders; move the order to `in_progress` and confirm
  both roles see it; move it to `done`/`cancelled` and confirm neither does;
  confirm a permitted patch actually saves.
- [ ] 4.13 `npm test` (alone) and `npx tsc --noEmit` clean.

---

## Follow-ups — named, deliberately not folded into this change

- **Recording parts actually used**, on the order detail after the work is
  done. `ordenServicioItem` keeps its table and its "Piezas utilizadas" card
  precisely so this stays a UI-only change later.
- Transcribing the handwritten *Trabajo realizado / Hallazgos* block back
  into `hallazgos` from the detail page, if the paper round-trip proves
  worth closing.
- A print sheet for a batch of orders, if one-at-a-time printing becomes the
  complaint.
- **`ServiceOrderForm`'s `products` prop, and the query that feeds it.** The
  prop is dead since the parts cart came out of creation (D7) but is kept on
  the type so `ServiceOrderFormTrigger` and `/service-orders/page.tsx` still
  compile. `page.tsx:78` still fetches the product list into that
  `Promise.all` and passes it at `:103` — **a live database round trip per
  page load feeding a prop nobody reads.** Removing the prop, the argument and
  the query is one deletion, deferred only because it belongs to WU1's files
  and WU1 is already open as PR #99.
- **Unbounded `text` on `plate`/`make`/`model`** on both vehicle write paths
  (design Open Question) — a `MAX_TEXT_LENGTH` bound belongs on both routes
  together, not only the new one.
- **Workshop name/logo on the printed sheet** — needs an R2-signed URL;
  left off until asked for.
- **Whether deselecting the customer should also clear an in-progress
  `VehicleQuickForm`** — assumed yes (the form is scoped to the selected
  customer and unmounts with the banner); no scenario was written for it.
- **A per-row edit affordance on `/service-orders`** — `RowActions` already
  renders a kebab on every row (`service-orders/page.tsx:192`), so the menu
  exists; what the row lacks is the session user and the full `orden` the gate
  needs (design D11). The detail page is the only entry point this change
  adds.

## Closing checklist (maps to proposal.md's Success Criteria)

- [ ] Selecting a customer clears the search box and result list; the
  banner's deselect also clears the chosen vehicle, measures ≥44×44 — WU1
- [ ] Edit mode offers no deselect — WU1
- [ ] Adding a vehicle to a customer with 3 active vehicles leaves all 4
  active, proven against real Postgres — WU2 (e2e, exit criterion)
- [ ] That same insert leaves `whatsappOptOut`/`emailOptOut` byte-identical
  — WU2 (e2e)
- [ ] `Descripción` is multi-line; the label reads
  `Fecha y hora de inicio` — WU1
- [ ] No parts section at creation; `observaciones` round-trips from form to
  detail view — WU1
- [ ] A create payload carrying `hallazgos`/`recomendaciones` is still
  ignored or rejected — WU1
- [ ] Imprimir produces one page with customer, vehicle, categoría, start
  time, descripción, observaciones, and the blank ruled block + signature
  line — verified in a real print preview, WU3
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit — all
  four
- [ ] Every unit was opened in a browser with the console read; WU3's
  verification is a real print preview, never a substitute test
- [ ] **Not in the original Success Criteria, added by this tasks pass**:
  the edit control and the `PATCH` route enforce the exact 8-combination
  role/status truth table, proven by a mutation-verified predicate test, a
  route test, and a browser check across roles and statuses — WU4
