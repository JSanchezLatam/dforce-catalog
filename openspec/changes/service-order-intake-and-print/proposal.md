# Proposal: Service Order Intake and Print

## Intent

The owner walked the "Nueva orden" dialog and named five things wrong with it.
Four are intake friction; the fifth is the one that matters.

| # | What he said | What it is |
|---|---|---|
| 1 | Selecting a customer should clear the search box and let him deselect | UX defect — `handleSelect` sets `selected` and never touches `term`/`results`, and no deselect affordance exists at all |
| 2 | If the customer has no vehicle, create one from this same view | Dead end today — the form blocks submission and tells staff to go add a vehicle elsewhere |
| 3 | `Descripción` should be a larger text field | It is a single-line `<Input>`; the field holds what the customer is asking for |
| 4 | `Cita` should read `Fecha y hora de inicio` | Label only |
| 5 | `Piezas` is not needed, and there must be a comments field | **The reason: "es una orden que se imprimirá y se le dará a los técnicos"** |

A sixth item surfaced after this proposal was first written, while the owner was trying to use the
feature: he cannot edit `hallazgos`, `recomendaciones` or `observaciones`. **It is not a permission
gate — there is no entry point at all.** `ServiceOrderFormTrigger` takes an optional `order` prop
that switches the form to edit mode, and its one and only call site — the `/service-orders`
list-page header — omits it, so the trigger is permanently in create mode. The order detail page
offers `OrderStatusControls` and links, and no edit control. The edit form, `updateOrder` and
`PATCH /api/service-orders/[id]` all exist and are tested, and **no UI reaches them**. It stayed
hidden because of a second defect fixed the same day — `POST /api/service-orders` could never save
(a JSON string reaching a declared `Date`), so there was never an order to try editing. Two defects
covering for each other. Mounting the control also means deciding **who** may use it and **when**:
see §5.

Item 5 exposed that **the printed order does not exist**. The whole dialog has
been designed as if the order were a database record staff read on screen. It is
not — it is a sheet of paper a técnico carries to the car. That reframing is what
makes items 3 and 5 changes rather than preferences: parts are chosen *while*
working, not when booking, and paper needs somewhere to write.

**Success looks like**: staff picks a customer, sees the search box clear and a
banner they can undo; the customer has no car, so they add plate/marca/modelo/año
without leaving the dialog; they type what the customer wants into a real
textarea, add observaciones, save, open the order and hit **Imprimir** — and get
one page with the customer, the vehicle, the categoría, the start time, and blank
ruled space under *Trabajo realizado / Hallazgos* with a signature line.

## Two deliberate spec amendments

`openspec/specs/service-orders/spec.md` currently contradicts items 3 and 5. Both
lines were written before "the order gets printed and handed to a technician"
existed as a requirement. Both change on purpose — **do not relitigate them.**

| Spec text today | Amendment |
|---|---|
| R20: create takes "zero or more `producto` line items" (spec.md:9), with a scenario asserting a line item is recorded at creation (spec.md:15) | Creation takes **no** line items. The scenario is **deleted**, not softened — there is no create path left for it to describe |
| "Category and Completion Notes Editing" (spec.md:33): `hallazgos`, `recomendaciones` and `observaciones` MUST NOT appear in the create dialog, with a scenario requiring a create payload carrying them to be ignored or rejected (spec.md:39) | **`observaciones` alone** becomes settable at creation. `hallazgos` and `recomendaciones` stay post-examination-only, and the ignore/reject scenario stays — narrowed to those two |

The `observaciones` split is the point: *hallazgos* is what the technician found
after looking at the car; *observaciones* is what the person taking the booking
needs to tell them before they start. They were collapsed because neither
existed at intake time.

## What changes

### 1. Customer picker — clear on select, and an explicit deselect

`CustomerPicker.tsx:109-112`. Selecting sets `selected` and leaves the term,
the result table and `hasSearched` exactly as they were, so the operator stares
at a list of eight customers with no signal which one is live.

- Selecting clears `term`, `results`, `total`, `relaxedFrom` and `hasSearched`.
- The selected-customer banner (`CustomerPicker.tsx:120-124`) gains an explicit
  control — an X or "Cambiar cliente". **Deselect is a control, not a side
  effect of picking someone else.** At `min-h-11 min-w-11`; AGENTS.md's 44x44
  rule applies and `size="sm"` alone does not satisfy it.
- **Deselecting MUST clear the dependent vehicle selection.** `ServiceOrderForm`
  holds `vehiculoId` in its own state (`ServiceOrderForm.tsx:108`), keyed off the
  customer. A stale vehicle id surviving a customer change is caught server-side
  by `createOrder`'s ownership check (`service.ts:210-213`) — as an error message
  the operator cannot explain. Fix it in the UI, keep the server check.
- **Create mode only.** Edit mode PATCHes `description`/`appointmentAt`/
  `categoria`/notes; `clienteId` is not patchable. Offering "Cambiar cliente" on
  an existing order promises something the API will not do.

`CustomerPicker.test.tsx` has zero tests that click "Seleccionar" and then assert
search-box state — this is new coverage, not a rewrite.

### 2. Inline vehicle creation — a NEW route, not the PATCH

**This is the correctness item, and reusing what exists would corrupt data.**

`planVehiculoReconcile` (`customers/vehicles.ts:172-217`) treats the payload's
`vehicles` array as the customer's **whole collection**. Its own comment says so
— "omitted from `incoming` (the original mechanism)" — and its deactivate filter
is `existing.filter(v => v.deactivatedAt === null && (!keptIds.has(v.id) || …))`.
Sending `PATCH /api/customers/[id]` with just the one new vehicle therefore
**silently deactivates every other active vehicle that customer owns.**

The second trap sits behind the obvious workaround. `ClienteListItem`
(`customers/queries.ts:29`) is a `Pick` that does **not** carry
`whatsappOptOut`/`emailOptOut`, but `CustomerForm.buildPayload` always resends
both from form state. Pre-seeding `CustomerForm` from the picker's data and
saving would **reset the customer's consent opt-outs to defaults**. AGENTS.md
names exactly this: those two booleans are "legally distinct consent regimes,
never collapse them." There is no `GET /api/customers/[id]` to fetch the full
row client-side either.

**Therefore:**

- New **`POST /api/customers/[id]/vehicles`** — a plain single insert, `can()`
  gated on `customers.write`, **never routed through `planVehiculoReconcile`**.
  That file's `route.ts` is GET-only today; this is additive.
- A small **vehicle-only form**: `placa`, `marca`, `modelo`, `año`. Literal to
  the ask, and it dodges the opt-out trap by construction — a form with no
  consent fields cannot reset consent. Reuse the existing vehicle validation in
  `customers/validation.ts` rather than writing a second copy (`sdd-design`
  confirms the exact export).
- On success the form selects the new vehicle and refetches; `ServiceOrderForm`
  already has the mechanism (`vehiclesRetry`, `ServiceOrderForm.tsx:109-111`).
- It renders where the empty-vehicle hint renders today
  (`VEHICLES_EMPTY_HINT_ID`), gated on `customers.write` — same rule the picker
  already applies to "Crear cliente nuevo".

**Correction, recorded so a future reader does not learn the wrong lesson:
dialog-inside-dialog is NOT a trap here.** It already ships —
`ServiceOrderForm` → `CustomerPicker` → `CustomerForm` (`CustomerPicker.tsx:210`)
is a Dialog nested in a Dialog, and `CustomerForm` nests a third for its
delete confirmation. The base-ui bug `table-redesign` WU3 hit was
**Menu/typeahead** eating keystrokes inside a Dialog — a different primitive,
which is why `ServiceOrderForm` deliberately uses a native `<select>`
(`ServiceOrderForm.tsx:383-386`). Do not generalise "nesting is dangerous".

### 3. Descripción, the label, Piezas, and observaciones

- `Descripción` becomes a `<textarea>` using the form's existing `NATIVE_FIELD`
  class (`ServiceOrderForm.tsx:38`) — which carries the focus-visible ring the
  native controls were missing. Not a fresh style.
- `Cita` → **`Fecha y hora de inicio`**. Label text only; the field stays
  `datetime-local` and `toDatetimeLocal` is untouched.
- The parts cart section (`ServiceOrderForm.tsx:502-582`, `!isEdit` only) is
  removed. `ServiceOrderForm.test.tsx` has zero references to it.
- `observaciones` joins the create form, the `POST /api/service-orders` request
  schema, and `createOrder`'s insert.

**Consequence, stated plainly rather than buried: `ordenServicioItem` will have
no writer left.** `createOrder` (`service.ts:235-245`, gated on
`items.length > 0`) is its only one, anywhere. The detail page's "Piezas
utilizadas" card (`service-orders/[id]/page.tsx:153-181`) will render its empty
state for every future order. **That is the direct consequence of the ask, not a
bug** — and the card stays in place, because parts are still the plan for a
later "record what was used" flow and existing orders may hold rows.

### 4. The printed order — `window.print()`, not the catalog PDF worker

The only PDF machinery in this repo is the catalog pipeline: two pg-boss jobs
(`pdf-generate` → `pdf-upload`), a Postgres advisory-lock queue cap of 3
(`enqueue.ts:27`), Playwright/Chromium, real-DOM-measured pagination
(`worker.ts:115+`), an R2 read/write and a temp-file handoff between jobs. It
exists to paginate a multi-page product catalog. Pointing it at a one-page sheet
means enqueue → Chromium boot → R2 write → authenticated download, in place of a
click.

**Recommend `@media print` plus `window.print()` on a print view**, reached from
an **Imprimir** button on the order detail page — not auto-opened after creation,
because the sheet is printed when the car arrives, not when the booking is taken.
`can()` on `service-orders.read` still applies (R23 default-deny).

The sheet must carry:

| Printed | Source |
|---|---|
| Cliente (nombre, teléfono) | `cliente` |
| Vehículo (placa, marca, modelo, año) | `vehiculo` |
| Categoría, Fecha y hora de inicio | `orden_servicio` |
| Descripción | what the customer asked for |
| Observaciones | new at creation |
| **Blank ruled space under "Trabajo realizado / Hallazgos", plus a signature line** | **nothing — this is print layout, not data** |

That last row is the reason the change exists. No column backs it and none
should; it is space for a pen.

### 5. The edit entry point, gated by role AND the order's current status

The control that opens an order in edit mode is mounted on the **order detail page**, beside
`OrderStatusControls`, at `min-h-11 min-w-11`. That page already holds the full `orden` row and the
session user, and already renders one status-dependent control in that slot. The list page's kebab
was the alternative and is rejected: there is no per-row menu on `/service-orders` today — its only
`DropdownMenu` is `OrderBulkStatusActions`, a selection-wide control — so hosting the gate there
means building a row-level affordance first.

Who may edit, and when:

| | `open` | `in_progress` | `done` / `cancelled` |
|---|---|---|---|
| **administrador** | may edit | may edit | **no one edits** |
| **tecnico** | — | may edit | **no one edits** |

The terminal row is **this change's decision, stated rather than asked**. The owner named `open`
and `in_progress` only. `done` and `cancelled` are already terminal — `assertTransition` gives them
no outgoing edges, so a closed order cannot be reopened through the UI. Allowing field edits there
would make closure reversible through a side door, one field at a time, with the badge still
reading `Completada`. **A correction path for a wrongly-closed order is its own change**, with its
own audit story; it is not this gate loosened.

**This is a new axis, not a tweak.** `src/modules/auth/policy.ts` is a flat role → action matrix
and `can(user, action)` takes no order, so it cannot express "admin while `open` or `in_progress`,
técnico only while `in_progress`". Both roles hold `service-orders.write` today, and
`PATCH /api/service-orders/[id]` checks only that — no role distinction and no status check
anywhere. So: **a pure predicate over `(role, status)`**, DB-free and unit-testable, imported by
both the detail page (to decide whether to render the control) and the route (to enforce it).
`policy.ts` gains no new `Action`.

**The UI deciding alone is not a gate.** The route is the trust boundary — the same reason
`isServiceCategory` is called there rather than trusted from the form. The route reads the order's
**current** status from the database before writing, never a status carried in the request body: a
tab rendered while the order was `open` will otherwise happily patch it after someone closed it. A
refusal answers in Spanish with an accurate code — 403 when the role is the reason, 409 when the
record's state is (the shape `POST /api/service-orders` already uses for `cliente_deactivated`) —
never a 500.

The gate covers `categoria`, `description`, `appointmentAt`, `hallazgos`, `recomendaciones` and
`observaciones`. **It does not reintroduce Piezas anywhere** — see below.

### Piezas: removed entirely, at creation and at edit

Asked to remove Piezas and later to edit Piezas, the owner was put the contradiction directly and
chose **remove entirely**. §3's delta stands unchanged: no parts at creation, no parts at edit. The
`ordenServicioItem` table and the "Piezas utilizadas" card both stay in place, empty.

## What explicitly does NOT change

- **The `ordenServicioItem` table.** No migration, no drop. The owner asked to
  remove the creation-time UI, not the data model. Dropping a table is risk for
  no benefit.
- **The "Piezas utilizadas" detail card** stays, empty.
- **`hallazgos` and `recomendaciones`** remain patch-only, post-examination.
  Only `observaciones` moves.
- **`CustomerForm`, `PATCH /api/customers/[id]`, and `planVehiculoReconcile`.**
  The new vehicle POST is purely additive; nothing about full-collection
  reconcile semantics changes.
- **The catalog PDF pipeline** — no new job, no R2 object, no Chromium.
- **The customer on an existing order** stays immutable; edit mode gains no
  deselect.
- No stock deduction, pricing or invoicing anywhere near this (AGENTS.md).
- Nothing in the list pages, `table-bulk-actions`, or sorting.

## Capabilities

### New Capabilities

None. The printed sheet is a `service-orders` behaviour, not a new capability —
giving it its own spec would split the order's own contract across two files.

### Modified Capabilities

- `service-orders` (`openspec/specs/service-orders/spec.md`): creation takes no
  `producto` line items and the R20 line-item scenario is deleted;
  `observaciones` is settable at creation while `hallazgos`/`recomendaciones`
  are not; an order has a printable one-page work sheet carrying blank space for
  handwritten findings; the customer picker clears its search on select and
  offers an explicit deselect that also clears the dependent vehicle; an
  existing order has an edit entry point at all, gated by a `(role, status)`
  predicate that both the UI and the PATCH route consult, with `done` and
  `cancelled` editable by nobody.
- `customer-management` (`openspec/specs/customer-management/spec.md`): a single
  vehicle may be added to an existing customer through a dedicated insert path
  that MUST NOT alter that customer's other vehicles or any other field of the
  customer row.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/modules/service-orders/CustomerPicker.tsx` | Modified | clear-on-select, deselect control at 44x44, `onDeselect` prop |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modified | textarea, label, parts section removed, observaciones, vehicle-create slot, clear `vehiculoId` on deselect |
| `src/app/api/customers/[id]/vehicles/route.ts` | Modified | add `POST` beside the existing `GET` |
| `src/modules/customers/` — new vehicle-only form | New | plate/make/model/year; **not** `CustomerForm` |
| `src/modules/service-orders/service.ts` | Modified | `createOrder` accepts `observaciones`; parts insert becomes unreachable |
| `src/app/api/service-orders/route.ts` | Modified | request schema: drop `items`, add `observaciones` |
| `src/modules/service-orders/edit-policy.ts` | New | pure `canEditOrderFields(role, status)` — the single truth table for the edit gate |
| `src/app/api/service-orders/[id]/route.ts` | Modified | field-patch branch reads the order's current status and refuses 403/409 in Spanish |
| `src/app/(app)/service-orders/[id]/page.tsx` | Modified | Imprimir button; edit control mounted behind the predicate at `min-h-11 min-w-11` |
| `src/app/(app)/service-orders/[id]/print/` | New | print view + `@media print` rules |
| tests | Modified/New | `CustomerPicker.test.tsx`, `ServiceOrderForm.test.tsx`, `service.test.ts`, new vehicles route test, e2e row for the insert, `edit-policy.test.ts`, and the existing `service-orders/[id]` route and page tests |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Adding a vehicle silently deactivates the customer's other vehicles.** Reusing `PATCH /api/customers/[id]` hands `planVehiculoReconcile` a one-element array it reads as the whole collection (`vehicles.ts:213-215`) | **High** | Binding: a new `POST /api/customers/[id]/vehicles` doing a plain single insert, never touching `planVehiculoReconcile`. An **e2e** row: customer with 3 active vehicles + 1 insert → 4 active, none deactivated |
| **Adding a vehicle silently resets `whatsappOptOut`/`emailOptOut`.** `ClienteListItem` omits both; `CustomerForm.buildPayload` always sends both. AGENTS.md: never collapse the two consent regimes | **High** | A vehicle-only form with no customer fields. Not `CustomerForm`, not pre-seeded from picker data, no customer payload on this path |
| **The new insert is real SQL in the injected-seam blind spot.** AGENTS.md: every unit test supplies the dep, so a green suite *proves* zero real-SQL coverage | **High** | The e2e above is a WU2 exit criterion, not a follow-up |
| **`@media print` output cannot be asserted in jsdom** — print styles do not apply and `window.print()` is stubbed | **High** | Browser + print preview **is** the verification for WU3, stated as such. Tests cover the data the view renders, never its printed layout |
| **The print view adds a client boundary** for `window.print()` next to server-rendered order data. AGENTS.md documents two production defects of exactly this class that a green suite could not see | Medium | Only ids/plain data cross the boundary; no functions, no `typeof document` render gates; console read in a browser |
| **The spec amendments get half-applied** — R20's prose edited while its line-item scenario survives, leaving the spec self-contradictory | Medium | The scenario is **deleted**, called out per-amendment above; `sdd-spec` must diff both requirements together |
| **Deselect ships without clearing `vehiculoId`**, producing a server-side ownership rejection the operator cannot explain | Medium | Named as a requirement, with its own test |
| A reader concludes "dialog nesting is dangerous" from `table-redesign` WU3 and over-engineers the vehicle form out of the dialog | Low | Corrected in §2: that bug was Menu/typeahead, and the nesting already ships |
| **The edit gate ships UI-only** — the control is hidden for a técnico on an `open` order and the route still accepts the PATCH, so anything that can send a request bypasses it | **High** | The route is the enforcement point and the UI is convenience. Route tests per refusal, asserting the exact Spanish string and the status code — not just "not 200" |
| **The route trusts a status from the request body**, so a tab rendered while the order was `open` can edit it after someone closed it | **High** | The gate is evaluated against the status read from the record, before the write. A scenario pins it: a body claiming `in_progress` over a stored `done` is still refused |
| The gate is written twice — once for the UI, once for the route — and the two drift on the first change | Medium | One pure predicate, imported by both call sites; the truth table exists in exactly one file |
| Someone reads the empty "Piezas utilizadas" card as a regression | Low | Stated as an accepted consequence here and in `tasks.md` |
| A reader treats the `done`/`cancelled` row as an oversight and "fixes" it by allowing admin edits on closed orders | Low | Recorded as a decision with its reason, here and in design D11; the correction path is named as a separate change |

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950 (~750 + ~200 for the edit gate) |
| Review budget (this session) | 800 lines per PR |
| 800-line budget risk | **Low per unit**, Medium total |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain, matching this repo's convention |

Decision needed before apply: No (auto-chain, cached at session start)
Chained PRs recommended: Yes
800-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Est. lines | Base |
|---|---|---|---|
| 0 | **Edit entry point + gate**: `canEditOrderFields(role, status)` and its truth-table test; the edit control mounted on the order detail page behind it at `min-h-11 min-w-11`; `PATCH /api/service-orders/[id]` reading the order's current status and refusing 403/409 in Spanish; route and page tests per role×status | ~200 | tracker |
| 1 | **Intake form**: picker clear-on-select + deselect control + `vehiculoId` clearing; `Descripción` textarea; `Cita` → `Fecha y hora de inicio`; parts section removed; `observaciones` through form → route schema → `createOrder` | ~250 | tracker |
| 2 | **Inline vehicle creation**: `POST /api/customers/[id]/vehicles` + route test + **e2e**, vehicle-only form, wiring into the empty-vehicle slot | ~300 | 1 |
| 3 | **Printed order**: print view, `@media print` rules, Imprimir on the detail page, blank findings block + signature line | ~200 | 2 |

```
tracker (draft, no-merge)
  └── 0 edit gate ── 1 intake ── 2 vehicle insert ── 3 print
```

**The edit gate is its own unit, not an extension of WU1.** WU1 is the create-mode form
(`CustomerPicker.tsx`, `ServiceOrderForm.tsx`) and the create path (`service.ts`,
`POST /api/service-orders`). The gate shares **not one file** with it: a new pure module, the order
detail page, and the PATCH route. Folding it into WU1 would put two unrelated review subjects — an
intake-UX pass and an authorization rule — behind one approval, and the authorization rule is the
half a reviewer must actually think about.

It lands **first**, ahead of WU1, for two reasons: it is the only unit fixing something the owner is
blocked on today, and it touches the order detail page that WU3 also edits, so landing it earlier in
the same linear chain costs no rebase. It could equally run in a parallel worktree beside WU1 — the
file sets are disjoint — but the chain is kept linear for the same reason it already was.

**WU1-3 are three, not the exploration's five — they collapse.** The exploration split
picker (~40-60), labels (~10-20) and parts removal (~80-120) into three units.
Two of the three edit the *same file*, `ServiceOrderForm.tsx`, and the third
edits its only child. Shipped apart they are three PRs that each rebase on the
previous one's conflict in one file, for a merged total of ~200 lines against an
800-line budget. Collapsing costs a reviewer nothing and saves two rebases. The
`observaciones` server path is folded in with them because it is the same user
action — filling in the create form.

**The other two do NOT collapse.** WU2 is the only unit that writes to the
database on a new path and is the only one carrying an e2e; WU3 is the only one
whose verification is a browser rather than a test. Merging either into WU1
buries the part that can actually go wrong. WU2 and WU3 touch disjoint files and
could run in parallel worktrees; kept linear because the print sheet renders
the vehicle fields WU2's form writes.

## Rollback Plan

Per unit, reverse order, all pre-merge to `main` — the tracker stays draft until
every child lands. No migration and no schema change anywhere in this change, so
nothing to un-apply: reverting 3 removes the print view and its button;
reverting 2 removes the POST route and restores the "add a vehicle first" dead
end; reverting 1 restores the parts cart and the single-line description;
reverting 0 removes the edit control and the route's status gate, returning the
app to the state this change found it in — where no UI reaches `updateOrder` at
all.

One asymmetry: **vehicles inserted through WU2's route survive a revert** — they
are ordinary `vehiculo` rows and remain correct, because the route's whole job is
to insert exactly one row and touch nothing else. That is the property the e2e
proves, and it is what makes the rollback boring.

## Dependencies

- None blocking. No new packages — `@media print` and `window.print()` are
  platform features.
- A reachable Postgres for `src/e2e/**` (excluded from `npm test`), and a
  customer with **three or more active vehicles** in it. AGENTS.md's precedent:
  a bug that depends on data volume does not exist until there is data — a
  single-vehicle customer cannot expose the reconcile trap at all.
- A printer or print preview for WU3. Not optional: it is the verification.
- WU0's predicate is DB-free and fully unit-testable, but confirming the control actually appears
  (and the dialog actually opens) needs seeded orders in each of the four statuses and a session in
  each role. `/service-orders` has 0 rows today.

## Follow-ups (recorded, not scoped)

1. **Recording parts actually used**, on the order detail after the work is
   done — the writer `ordenServicioItem` loses in this change. The table is kept
   precisely so this stays a UI change later, not a migration.
2. Transcribing the handwritten *Trabajo realizado / Hallazgos* block back into
   `hallazgos` from the detail page, if the paper round-trip proves worth closing.
3. A print sheet for a batch of orders (a day's work), if one-at-a-time printing
   becomes the complaint.
4. **A correction path for a wrongly-closed order.** §5 makes `done` and `cancelled` editable by
   nobody, which is right for the ordinary case and leaves no way to fix a genuine mistake. That
   path needs its own audit story — who reopened what, and why — and is deliberately not this
   gate loosened.

## Success Criteria

- [ ] An `administrador` opening an `open` order's detail page gets a control that opens the edit
      form; a `tecnico` on the same order gets none; both get it on `in_progress`; neither gets it
      on `done` or `cancelled` — and the control measures at least 44x44
- [ ] `PATCH /api/service-orders/[id]` refuses the same combinations the UI would not have offered,
      in Spanish and with an accurate status code, asserted by route tests — a técnico patching an
      `open` order is refused even though the button was simply never rendered for them
- [ ] A patch whose body claims a status is still gated on the status read from the record
- [ ] Selecting a customer clears the search box and the result list; the banner
      offers an explicit deselect that also clears the chosen vehicle — asserted
      by tests, and the deselect control measures at least 44x44
- [ ] Edit mode offers no deselect
- [ ] Adding a vehicle from the order dialog to a customer who already has three
      active vehicles leaves **all four active** — proven against a real Postgres,
      not a mocked seam
- [ ] That same save leaves `whatsappOptOut` and `emailOptOut` byte-identical
- [ ] `Descripción` is a multi-line field; the label reads `Fecha y hora de inicio`
- [ ] The create dialog has no parts section, and `observaciones` round-trips
      from the form to the detail view
- [ ] A create payload carrying `hallazgos` or `recomendaciones` is still ignored
      or rejected
- [ ] Imprimir on an order detail produces one page carrying customer, vehicle,
      categoría, start time, descripción, observaciones, and blank space under
      "Trabajo realizado / Hallazgos" with a signature line — verified in a real
      print preview
- [ ] `npm test` and `npx tsc --noEmit` clean at the end of every unit
- [ ] WU3 was opened in a browser with the console read; a green suite is not
      evidence for a print view
