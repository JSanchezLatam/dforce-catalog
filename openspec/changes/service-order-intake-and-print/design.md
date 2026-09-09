# Design: Service Order Intake and Print

## Technical Approach

Four seams, three of which already exist in the repo, plus one genuinely new write path.

1. **The picker** is client state in `CustomerPicker` plus one new `onDeselect` prop. No new
   data, no new route — D6.
2. **The intake fields** are a `<textarea>`, a label string, a deleted section, and one column
   (`observaciones`) threaded through a create path that already carries three siblings on the
   PATCH route — D7.
3. **The vehicle insert** is the only new server code in the change: one route method, one
   module function, and deliberately **no** reuse of the collection reconcile that would corrupt
   data if reused — D1/D2/D3.
4. **The printed sheet** is a second Server Component over the two queries the detail page
   already runs, plus a `@media print` block for the app shell. Zero new SQL, zero new jobs,
   zero new dependencies — D8/D9.

The baseline is `main` @ `a8cd3e0`. `observaciones` already exists as a column, already renders
on the detail page (`service-orders/[id]/page.tsx:148`) and is already accepted by
`PATCH /api/service-orders/[id]` (`NULLABLE_TEXT_FIELDS`, `[id]/route.ts:17`). Only the create
half is missing, which is why D7 is a thread-through and not a schema change.

---

## D1 — `POST /api/customers/[id]/vehicles` is a single insert. `planVehiculoReconcile` is never on this path.

`planVehiculoReconcile` (`customers/vehicles.ts:172`) reads its `incoming` argument as the
customer's **whole collection**. Its deactivate filter is
`existing.filter(v => v.deactivatedAt === null && (!keptIds.has(v.id) || deactivateAsked.has(v.id)))`
(`vehicles.ts:213-215`) and its own comment names the mechanism: *"omitted from `incoming` (the
original mechanism)"*. Handing it a one-element array therefore deactivates every other active
vehicle the customer owns. That is not a bug to fix — it is the contract
`vehicles-one-to-many` D5 chose on purpose (`vehicles: []` means "deactivate everything"), and
this change does not reopen it.

| Option | Buys | Costs |
|---|---|---|
| Reuse `PATCH /api/customers/[id]` with a one-element `vehicles` array | zero new route, zero new registry entry | **silently deactivates every other vehicle**; and the client has no way to send the full collection (D4) |
| Reuse it after GET-ing the full collection first | correct reconcile input | there is no `GET /api/customers/[id]`; `ClienteListItem` omits the consent booleans (D4); two round trips to insert one row |
| **New `POST` beside the existing `GET`** | one INSERT, one row, nothing else touched | one route method, one module function, one registry entry, one e2e row |

**Chosen: the new POST.** It lives beside the `GET` already at that path
(`api/customers/[id]/vehicles/route.ts`) and delegates to a new `createVehiculo` in
`customers/vehicles.ts` — **not** to the route. `vehicles.ts` is the only file that imports
`vehiculo` from `schema.ts` (`vehicles-one-to-many` D3, "one owner"), and that rule is why the
insert goes there rather than inline in the handler.

**The trust boundary inside the reused validator.** `validateVehiculoInput`
(`customers/validation.ts:113`) is reused rather than copied, but its return type is
collection-shaped: it accepts `id`, `deleted` and `deactivated`, and it permits `plate: ""`
when `deleted === true` (`validation.ts:120`). A single-insert endpoint that forwarded those
would let a caller write a plate-less row — exactly the shape migration `0013`'s pre-flight
guard aborts on. So the route **rejects** a body carrying `id`, `deleted` or `deactivated` with
a 400 rather than dropping them, matching this repo's standing choice to refuse rather than
coerce (`api/customers/[id]/route.ts:76` refuses a non-boolean `active` for the same reason).
Only `plate`, `make`, `model`, `year` reach `createVehiculo`.

**No plate-uniqueness check.** There is none today: `vehiculoPlateExists` (`vehicles.ts:95`) is
a search predicate, not a constraint, and the reconcile path happily writes duplicates. Adding
one only here would be a new rule on one of two write paths. Out of scope, stated so nobody
reads its absence as an oversight.

## D2 — What actually stops a future "consolidation" of the two paths

`route-guards.test.ts` is real machinery and it is worth being exact about what it buys, because
it is the thing a reader will assume covers this.

**What it catches.** Adding `export async function POST` to that `route.ts` without a
`ROUTE_GUARDS` entry fails *"declares every method the route exports"* (`route-guards.test.ts:313`).
Declaring `POST: "customers.write"` without a literal `can(user, "customers.write")` in the file
fails the cross-reference suite (`:229`). The permission decision therefore cannot ship
undeclared or misnamed.

**What it does not catch, plainly.** It is textual and file-scoped — its own doc comment says it
"does not distinguish between HTTP methods in the same file" (`:210-213`), so with `GET`
declaring `customers.read` and `POST` declaring `customers.write`, both strings appearing
anywhere in the file satisfies it. And it says **nothing about write semantics**: deleting the
POST and re-pointing the form at `PATCH /api/customers/[id]` leaves the whole suite green,
because the registry entry disappears from the filesystem enumeration along with the method.
**The registry protects the permission surface, not the collection contract.**

Four things pin the separation instead, in descending order of how hard they are to defeat:

1. **The type signature.** `createVehiculo(clienteId: string, input: NewVehiculoInput): Promise<Vehiculo>`
   takes one vehicle and returns one row; `planVehiculoReconcile(existing, incoming: VehiculoInput[] | undefined): VehiculoPlan`
   takes a whole collection and returns four lists. A consolidation cannot be a call-site swap —
   it has to change types on both sides, which is the point a reviewer sees it.
2. **A DB-free unit test that runs in `npm test`.** `createVehiculo` is exercised against a fake
   `TxLike` recording every call and asserts **exactly one `insert` and zero `update`**, with
   three existing active vehicles present in the fixture. Mutation-verify it by routing the same
   input through `planVehiculoReconcile` + `applyVehiculoPlan`: `applyVehiculoPlan` issues an
   UPDATE per deactivation (`vehicles.ts:244`), so the test must go red **by name**. This is the
   guard that runs on every commit.
3. **The e2e row** — 3 active vehicles + 1 insert → 4 active, none deactivated, and both consent
   booleans byte-identical. It is the only thing that proves this against real SQL, and
   `src/e2e/**` is excluded from `npm test`, so it is a WU2 **exit criterion** in `tasks.md`, not
   a background guarantee.
4. **Placement.** `createVehiculo` sits in `vehicles.ts` sixty lines below the reconcile filter it
   must not use, with a comment on each naming the other. Weakest of the four, written anyway.

**Residual, named rather than fixed**: nothing prevents a future edit from making the *form*
call PATCH instead. Only (3) would catch it, and only when someone runs it. That is the honest
ceiling of a test suite whose DB seam is injected everywhere.

## D3 — Permission is `customers.write`; record state answers with the codes the neighbours already use

Read off the two neighbours rather than invented: the `GET` at this exact path is
`customers.read` (`ROUTE_GUARDS:38`), and `PATCH /api/customers/[id]` — the only other path that
writes a vehicle — is `customers.write` (`:36`, with `customers.deleteVehicle` required only
when the payload asks to destroy a row). Adding a vehicle is a reversible write, so:

```ts
"/api/customers/[id]/vehicles": { GET: "customers.read", POST: "customers.write" },
```

No new `Action`, no `policy.ts` change, and the picker's existing `customers.write` gate on
"Crear cliente nuevo" is the same rule the vehicle form renders behind.

`customers.deleteVehicle` is deliberately **not** listed: this endpoint cannot delete, and D1
rejects the `deleted` field outright.

Record state, matching `POST /api/service-orders` (`service-orders/route.ts:53-60`) verbatim:
unknown `clienteId` → **404** `not_found`; deactivated customer → **409** `cliente_deactivated`
(the caller is permitted; the record refuses — a 403 would send them hunting a missing
permission). Both come from one `getClienteById` call before the insert, which is also what
turns an FK violation into an answer instead of a 500.

## D4 — A vehicle-only form, because it cannot reset consent by construction

`ClienteListItem` (`customers/queries.ts:29`) is a `Pick` that does **not** carry
`whatsappOptOut` or `emailOptOut`, and `CustomerForm.buildPayload` always resends both from form
state. Pre-seeding `CustomerForm` from picker data and saving therefore writes the form's
defaults over the customer's real opt-outs. AGENTS.md names exactly this: the two booleans are
"legally distinct consent regimes, never collapse them." There is no `GET /api/customers/[id]`
to fetch the true values from either.

**The mitigation is structural, not procedural.** `VehicleQuickForm` holds four fields —
`placa`, `marca`, `modelo`, `año` — and posts them to an endpoint whose handler cannot address a
`cliente` column at all (D1). A form with no consent fields, posting to a route with no customer
payload, **cannot** reset consent. That is the reason for a separate component, and it is
written here so the next person does not "simplify" it back into `CustomerForm` and reintroduce
the trap silently.

**Rejected — pre-seed `CustomerForm` and hide the customer fields.** Hidden fields still ship in
`buildPayload`; the defect would be invisible on screen and only visible in the row.
**Rejected — extend `ClienteListItem` with the two booleans.** It widens a projection used by
the list page and the picker so that one dialog can avoid a trap it should not be near.

## D5 — Correction: dialog nesting is not the trap. Do not redesign around it.

`ServiceOrderForm` → `CustomerPicker` → `CustomerForm` is **already** a Dialog inside a Dialog
(`CustomerPicker.tsx:210-213`), and `CustomerForm` nests a third for its delete confirmation.
That ships today. `VehicleQuickForm` renders inside the same existing nesting and adds no new
depth of its own.

The base-ui defect `table-redesign` WU3 hit was **Menu/typeahead swallowing keystrokes inside a
Dialog** — a different primitive, which is why `ServiceOrderForm` deliberately uses a native
`<select>` for its category field (`ServiceOrderForm.tsx:383-386`). `VehicleQuickForm` uses
native `<input>`s and inherits nothing from that finding.

Recorded as a decision so a future reader does not generalise "nesting is dangerous" from WU3
and lift the vehicle form out into a separate page, a portal or a route — solving a problem this
change does not have, at the cost of the one thing the owner asked for ("without leaving the
dialog").

## D6 — Deselect is a control, and clearing `vehiculoId` is part of it

Selecting clears `term`, `results`, `total`, `relaxedFrom` and `hasSearched`
(`CustomerPicker.tsx:109-112` sets none of them today). The selected-customer banner
(`:120-124`) gains an explicit control at `min-h-11 min-w-11` — AGENTS.md's 44×44 rule binds
(workshop tablets, and the sidebar-rail waiver is pointer-only), and `size="sm"` alone is 32px.

The dependent-state rule is the part that must not get lost: `ServiceOrderForm` holds
`vehiculoId` in its own state (`ServiceOrderForm.tsx:108`), keyed off the customer. Deselect
therefore fires `onDeselect`, and `ServiceOrderForm` clears `vehiculoId` in the same handler. A
stale id is already caught server-side by `createOrder`'s ownership check — as an error message
the operator cannot explain. **Both stay**: the UI clears it, the server keeps refusing it.

Create mode only. Edit mode PATCHes `description`/`appointmentAt`/`categoria`/notes and
`clienteId` is not patchable, so offering "Cambiar cliente" there would promise what the API
will not do.

## D7 — `observaciones` in, `items` out; `ordenServicioItem` keeps its table and loses its writer

`CreateOrdenServicioInput` (`service-orders/service.ts:120-128`) drops `items` and gains
`observaciones?: string | null`. The create route stops forwarding `items` and starts forwarding
`observaciones`. Nothing else on the create path moves.

`hallazgos` and `recomendaciones` stay post-examination-only and the existing ignore/reject
behaviour narrows to those two, per the proposal's spec amendment — `sdd-spec` owns the wording.

**Stated consequence, not a bug**: `createOrder`'s item insert (`service.ts:235-245`, gated on
`items.length > 0`) is `ordenServicioItem`'s only writer anywhere, so the table gets none. The
"Piezas utilizadas" card (`[id]/page.tsx:153-181`) renders its empty state for every future
order and **stays** — existing rows may exist and "record what was used" is a planned follow-up.
No migration, no drop.

## D8 — A dedicated print route inside `(app)`; the shell comes off with `@media print`

Browser print rather than the catalog worker is decided (`pdf-generate` → `pdf-upload`, an
advisory-lock queue cap of 3, Playwright/Chromium, DOM-measured pagination, an R2 round trip and
a temp-file handoff — built to paginate a multi-page catalog, not to hand a técnico one page).
The open part is *where the paper layout lives*.

| Option | Buys | Costs |
|---|---|---|
| `@media print` overrides on `service-orders/[id]/page.tsx` | one file, one query set | **default-visible**: every card added to the detail page later lands on the technician's sheet unless someone remembers `print:hidden`. Breadcrumb, `OrderStatusControls`, Piezas and Recordatorios all need hiding on day one, and the paper layout is expressed as overrides of a `<dl>` grid |
| **Dedicated `/service-orders/[id]/print`** | **default-empty**: only what is authored there prints. Detail page keeps evolving with no print regressions. Linkable, reloadable, re-printable, openable straight in print preview | one more page file, one registry entry, a second run of two queries the page already runs |

**Chosen: the dedicated route**, at `src/app/(app)/service-orders/[id]/print/page.tsx`. Inside
the `(app)` group deliberately — a duplicated `service-orders/[id]` segment across two route
groups is a routing risk this change has no reason to take, and `filePathToUrl` strips `(app)`
so the registry key is `/service-orders/[id]/print` either way. It gets its own
`requireSessionFromHeaders()` + `can(user, "service-orders.read")`, like every other page.

**Keeping the shell off the paper.** The `(app)` layout renders `AppSidebar` as a sibling the
page cannot reach, so it is hidden from `globals.css` — the only global CSS this change adds,
and the first `@media print` block in the repo:

```css
@media print {
  [data-slot="sidebar"],
  [data-slot="sidebar-trigger"],
  [data-slot="sidebar-rail"] { display: none !important; }
  [data-slot="sidebar-inset"] { margin: 0 !important; box-shadow: none !important; }
}
```

Those selectors are verbatim from `components/ui/sidebar.tsx` (`:170`, `:264`, `:286`, `:308`).
Everything *inside* the page uses Tailwind 4's built-in `print:` variant instead; the global
block exists only for what the page cannot reach.

**The client boundary is one button, and it is on the sheet.** "Imprimir" on the detail page is a
plain `<Link href={`/service-orders/${id}/print`}>` styled with `buttonVariants` at
`min-h-11 min-w-11` — following `customers/page.tsx:279`, which uses `buttonVariants` on a
`Link` rather than `<Button render={<Link/>}>` for the reason its comment records. The detail
page gains **no** client component. The print page carries one: `PrintButton`, a `"use client"`
`<button onClick={() => window.print()} className="print:hidden">`. **No `useEffect`
auto-print, no `typeof document` gate** — AGENTS.md names that gate as React's documented cause
#1 for a hydration mismatch and it already shipped here once. Only `string` props cross the RSC
boundary; `PrintButton` takes none at all.

## D9 — The blank space is layout. Nothing in the schema backs it, and nothing should.

The sheet renders, from data: cliente `name` + `phone`, vehículo `plate`/`make`/`model`/`year`,
`CATEGORIA_LABEL[categoria]`, `formatDateTime(appointmentAt)`, `description`, `observaciones`.
All of it comes from `getOrdenServicioById` + `getClienteById` — the same two calls
`[id]/page.tsx:76-83` already makes. **This change adds no SQL at all**, which is why WU3 needs
no throwaway Postgres, only seeded rows to look at.

Under those fields sits an empty bordered block headed **"Trabajo realizado / Hallazgos"** and a
signature line. It lives **only** in `print/page.tsx` as markup — repeated `border-b` rules and a
fixed height. There is no column, no field, no migration and no state behind it, and there
should not be: it is space for a pen.

The sheet deliberately does **not** print `hallazgos` or `recomendaciones`. Doing so would fill
the block on a reprint of a worked order, and the block being unconditionally empty is the whole
point. Transcribing the handwriting back into `hallazgos` is proposal follow-up 2, not this.

## D10 — Testing, written against AGENTS.md's two documented limits

**The injected-seam limit is why this change exists.** `POST /api/service-orders` shipped unable
to save anything: the route forwarded `body.appointmentAt` — a **string**, because JSON has no
Date — into `CreateOrdenServicioInput.appointmentAt: Date | null`, and Drizzle died on
`value.toISOString is not a function`. Every unit test passed because every unit test built its
own already-typed input object. The orders table is empty today as a direct result. The fix is
in `service-orders/route.ts:25-43` and its comment records the measurement.

**The shape of test that would have caught it**, and the shape this change owes:

> Enter at the **route handler**, with a body that is a **JSON round trip** of exactly what the
> browser sends (`JSON.parse(JSON.stringify(formState))` — never a hand-typed literal), and
> assert on **what the injected seam received**, not that the call resolved.
> `expect(seen.appointmentAt).toBeInstanceOf(Date)` fails on a string; `expect(...).resolves.toBeTruthy()`
> does not, because the fake seam accepts anything.

The same shape applies here twice. `validateVehiculoInput` keeps `year` only when
`typeof value.year === "number"` (`validation.ts:126`), so a form sending `"2019"` from an
`<input type="number">` loses the year **silently** — the identical class of defect, one field
over. So: the form coerces with `Number()`, and the route guards `year` explicitly (400
`{ errors: { year: "Año inválido" } }`) rather than dropping it, mirroring the
`NULLABLE_TEXT_FIELDS` guard at `service-orders/[id]/route.ts:46-58` which exists for this exact
reason. The route test drives that with a JSON-round-tripped body and asserts what
`createVehiculo` received.

**jsdom cannot see `@media print` or `window.print()`.** Print styles are not applied,
`window.print` is a stub, and no assertion can be written about page breaks, margins, whether
the sidebar actually vanished or whether the ruled block fits on one sheet. A green suite is not
evidence for WU3. **The browser and a real print preview are the verification**, stated as an
exit criterion, with the console read — jsdom also cannot see an RSC serialization refusal, and
WU3 adds a client boundary next to server-rendered data.

**Seeding is a prerequisite, not a nicety.** `/service-orders` has **0 rows** and only **2 of 370
customers** have a vehicle. AGENTS.md's precedent stands: a bug that depends on data volume does
not exist until there is data — a single-vehicle customer cannot expose D1's reconcile trap at
all, so WU2's e2e needs a customer with **three or more** active vehicles, and WU3 needs at least
one order with a customer, a vehicle, a description and observaciones to render.

| Layer | What | How | WU |
|---|---|---|---|
| Component (jsdom) | Selecting a customer clears the search box, results, total and `hasSearched`; the banner shows an explicit deselect | `CustomerPicker.test.tsx` — new coverage, zero tests click "Seleccionar" today | 1 |
| Component (jsdom) | Deselect clears `vehiculoId`; edit mode renders no deselect | `ServiceOrderForm.test.tsx`; assert the Spanish strings, never loosened | 1 |
| Component (jsdom) | `Descripción` is a `textarea`; the label reads `Fecha y hora de inicio`; no parts section | idem — no existing test references the cart | 1 |
| Unit (node) | `observaciones` reaches the insert; `items` is gone from the create input | `service.test.ts`, injected seam | 1 |
| Route (node) | POST rejects `id`/`deleted`/`deactivated` (400), a string `year` (400), unknown cliente (404), deactivated cliente (409); `customers.write` denied → 403 | JSON-round-tripped bodies; assert what the seam **received**, per the shape above | 2 |
| Unit (node) | `createVehiculo` issues **exactly one `insert` and zero `update`** with 3 existing active vehicles | fake `TxLike`; **mutation-verify** by swapping in `planVehiculoReconcile` + `applyVehiculoPlan` — must go red by name (D2) | 2 |
| **e2e (real Postgres, not `npm test`)** | 3 active vehicles + 1 insert → **4 active**, none deactivated; `whatsappOptOut`/`emailOptOut` byte-identical | new describe in `src/e2e/full-flow.e2e.test.ts`; **WU2 exit criterion** | 2 |
| Component (jsdom) | The print page renders every field the sheet must carry, and the ruled block is empty | data only — never layout | 3 |
| **Browser, console open — the only evidence that exists** | One page; sidebar, breadcrumb and buttons absent from the paper; the ruled block and signature line fit; the print route renders at all (RSC refusals are invisible to jsdom); Imprimir measures ≥44×44 | real print preview on a seeded order, recorded in the PR body | 3 |

## Data Flow

```
ServiceOrderForm ("use client")
  ├─ CustomerPicker ──select──▶ clear term/results/total/relaxedFrom/hasSearched      D6
  │                  ──deselect (explicit, ≥44×44)──▶ onDeselect() ─▶ setVehiculoId("")
  │
  ├─ GET /api/customers/[id]/vehicles ──[]──▶ VehicleQuickForm  (customers.write)     D4
  │        │                                        │ {plate, make, model, year}
  │        │        POST /api/customers/[id]/vehicles
  │        │                    ▼
  │        │        reject id|deleted|deactivated · guard year · validateVehiculoInput  D1
  │        │                    ▼
  │        │        getClienteById → 404 / 409 ─┬─ createVehiculo()  ONE INSERT        D3
  │        └────vehiclesRetry refetch───◀── 201 {vehiculo} ──┘   (no plan, no UPDATE)  D2
  │
  └─ POST /api/service-orders {clienteId, vehiculoId, categoria, description,
                               observaciones, appointmentAt}   ← no `items`            D7
                    ▼
            createOrder ─▶ orden_servicio          (ordenServicioItem: no writer left)
                    ▼
  /service-orders/[id] ──<Link> "Imprimir"──▶ /service-orders/[id]/print               D8
                                                   │ Server Component, same 2 queries
                                                   ├─ PrintButton ("use client") → window.print()
                                                   └─ blank "Trabajo realizado / Hallazgos" + firma  D9
```

## File Changes

| File | Action | Description | WU |
|---|---|---|---|
| `src/modules/service-orders/CustomerPicker.tsx` | Modify | clear-on-select; deselect control `min-h-11 min-w-11`; `onDeselect?: () => void` (D6) | 1 |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modify | textarea via `NATIVE_FIELD`; label; parts section deleted; `observaciones`; clear `vehiculoId` on deselect; vehicle-form slot at `VEHICLES_EMPTY_HINT_ID` | 1 |
| `src/modules/service-orders/service.ts` | Modify | `CreateOrdenServicioInput`: drop `items`, add `observaciones` (D7) | 1 |
| `src/app/api/service-orders/route.ts` | Modify | stop forwarding `items`, forward `observaciones` | 1 |
| `src/modules/service-orders/{CustomerPicker,ServiceOrderForm}.test.tsx`, `service.test.ts` | Modify | D6/D7 coverage | 1 |
| `src/app/api/customers/[id]/vehicles/route.ts` | Modify | add `POST` + `handleCreateVehiculo` beside the existing `GET` (D1/D3) | 2 |
| `src/modules/customers/vehicles.ts` | Modify | `createVehiculo` — single insert, sole owner of `vehiculo` (D1) | 2 |
| `src/modules/customers/VehicleQuickForm.tsx` | Create | four fields, no consent fields (D4) | 2 |
| `src/modules/auth/route-guards.test.ts` | Modify | `POST: "customers.write"` on the vehicles entry (D3) | 2 |
| `src/app/api/customers/[id]/vehicles/route.test.ts`, `customers/vehicles.test.ts` | Create/Modify | D2's zero-UPDATE test; D10's route tests | 2 |
| `src/e2e/full-flow.e2e.test.ts` | Modify | 3 active + 1 insert → 4 active; opt-outs unchanged (D2) | 2 |
| `src/app/(app)/service-orders/[id]/print/page.tsx` | Create | the sheet (D8/D9) | 3 |
| `src/modules/service-orders/PrintButton.tsx` | Create | `"use client"`, `window.print()`, `print:hidden`, no props | 3 |
| `src/app/(app)/service-orders/[id]/page.tsx` | Modify | "Imprimir" `<Link>` at `min-h-11 min-w-11` | 3 |
| `src/app/globals.css` | Modify | one `@media print` block hiding the shell (D8) | 3 |
| `src/modules/auth/route-guards.test.ts` | Modify | `"/service-orders/[id]/print": { GET: "service-orders.read" }` | 3 |
| `src/modules/customers/CustomerForm.tsx`, `queries.ts`, `planVehiculoReconcile`, `PATCH /api/customers/[id]` | **Unchanged** | consequence of D1/D4 — full-collection reconcile semantics are untouched | — |
| `src/shared/db/schema.ts`, migrations, `ordenServicioItem` | **Unchanged** | no schema change anywhere in this change (D7/D9) | — |

## Interfaces

```ts
// src/modules/customers/vehicles.ts — sole owner of `vehiculo` (vehicles-one-to-many D3).
// Takes ONE vehicle, returns ONE row. Never routed through planVehiculoReconcile — see D1/D2.
export type NewVehiculoInput = Pick<VehiculoInput, "plate" | "make" | "model" | "year">;
export function createVehiculo(
  clienteId: string,
  input: NewVehiculoInput,
  deps?: { tx?: TxLike },
): Promise<Vehiculo>;

// src/app/api/customers/[id]/vehicles/route.ts — beside the existing GET.
export type CreateVehiculoRouteDeps = {
  getClienteById?: typeof getClienteByIdQuery;   // 404 / 409, D3
  createVehiculo?: typeof createVehiculoService;
};
export function handleCreateVehiculo(
  request: NextRequest,
  clienteId: string,
  deps?: CreateVehiculoRouteDeps,
): Promise<NextResponse>;                        // 201 { vehiculo } | 400 | 403 | 404 | 409
export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse>;

// src/modules/customers/VehicleQuickForm.tsx — "use client". Both ends are client
// components, so `onCreated` never crosses an RSC boundary (D4/D8).
export function VehicleQuickForm(props: {
  clienteId: string;
  onCreated: (vehiculoId: string) => void;
  onCancel: () => void;
}): React.JSX.Element;

// src/modules/service-orders/service.ts — D7
export type CreateOrdenServicioInput = {
  clienteId: string;
  vehiculoId: string;
  categoria: ServiceCategory;
  description?: string | null;
  observaciones?: string | null;   // new at creation; hallazgos/recomendaciones stay patch-only
  appointmentAt?: Date | null;
  createdBy?: string | null;
  // `items` removed
};

// src/modules/service-orders/CustomerPicker.tsx — D6
export function CustomerPicker(props: {
  /* …existing props… */
  onDeselect?: () => void;   // create mode only; absent in edit mode
}): React.JSX.Element;

// src/modules/service-orders/PrintButton.tsx — "use client", zero props (D8)
export function PrintButton(): React.JSX.Element;

// src/app/(app)/service-orders/[id]/print/page.tsx — Server Component
export default function ServiceOrderPrintPage(
  { params }: { params: Promise<{ id: string }> },
): Promise<React.JSX.Element>;
```

## Threat Matrix

N/A — no shell command, subprocess, git/PR automation, executable-file classification or
process-integration boundary. `@media print` and `window.print()` are platform features; no new
package, no new job, no new binary.

Two untrusted-input surfaces exist and are closed in the design rather than left implicit:

- **The POST body** — `id`, `deleted` and `deactivated` are refused with a 400 rather than
  dropped (D1), which is what stops a plate-less or foreign-id row reaching the insert; a
  non-numeric `year` is refused rather than silently lost (D10).
- **The `[id]` path segment** — resolved by `getClienteById` before the insert, so an unknown or
  deactivated customer answers 404/409 instead of an FK violation (D3). It is never concatenated
  into SQL; `vehicles.ts` builds every statement through Drizzle.

## Migration / Rollout

No migration, no schema change, no new `Action`, no new package. Three units,
feature-branch-chain, tracker draft until every child lands (`auto-chain`, cached at session
start). Each unit is additive and independently revertible: reverting 3 removes the print page,
the button and the CSS block; reverting 2 removes the POST and restores the "add a vehicle
elsewhere" dead end; reverting 1 restores the parts cart and the single-line description.

One asymmetry, and it is the property D2's e2e proves: **vehicles inserted through WU2's route
survive a revert.** They are ordinary `vehiculo` rows, correct on their own, because the route's
whole job is to insert exactly one row and touch nothing else.

| WU | Authored lines (est.) | 800-line budget risk | Independently revertible |
|---|---|---|---|
| 1 — intake form + `observaciones` server path | ~250 | Low | Yes |
| 2 — POST route + `createVehiculo` + form + e2e | ~300 | Low | Yes |
| 3 — print page, button, `@media print` | ~200 | Low | Yes |

## Open Questions

- [ ] **Unbounded `text` on `plate`/`make`/`model`.** `service-orders/[id]/route.ts` caps its
      text columns at `MAX_TEXT_LENGTH = 5000` for a reason its comment states; the vehicle write
      paths have no bound on either route. Adding one only to the new POST would put two rules on
      one table. `tasks.md` follow-up, both paths together.
- [ ] **Workshop name/logo on the sheet.** The `(app)` layout already loads `getWorkshopConfig()`,
      but the logo needs an R2-signed URL. Left off: the sheet goes to a técnico inside the
      workshop. Add when it is asked for.
- [ ] **Whether the picker's deselect should also clear an in-progress `VehicleQuickForm`.**
      Assumed yes — the form is scoped to the selected customer and unmounts with the banner.
      `sdd-spec` owns whether that needs a scenario of its own.
