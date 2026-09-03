# Design: Service History per Vehicle (C4)

## Technical Approach

`orden_servicio` gains `vehiculo_id` (NOT NULL, FK `restrict`), a `categoria` enum and three
nullable note columns in one migration against an empty table. Every read and write reuses a
seam that already exists: `createOrder` validates vehicle ownership from the `getClienteById`
result **it already fetches**, the SEAM is filled with the `select` C3 put on `TxLike` for it,
and the vehicle screen composes two existing-shape reads in a page — the way
`service-orders/[id]/page.tsx` already composes three modules. No new module edge is created
by any of the six decisions below.

Three chained PRs per the proposal (WU1 schema+picker+SEAM+e2e, WU2 category+notes,
WU3 vehicle screen).

## Architecture Decisions

### D1 — The dependency asymmetry is real; extend it, and keep composition in the page

**Verified by reading the imports, not the brief.** `customers/queries.ts:13` imports
`ordenServicio` from `@/shared/db/schema` and queries it inline at L100–104;
`service-orders/service.ts:30` imports `getClienteById` from `@/modules/customers/queries`.
So `service-orders → customers` exists, and reading `orden_servicio` from `customers` is
established. Explore.md's claim is **confirmed**.

But "extend the asymmetry" does not mean "put the new read in `customers/queries.ts`". Three
placements, three different reasons:

| Read | Home | Why |
|---|---|---|
| Vehicle history (`listOrdenesByVehiculo`) | `service-orders/queries.ts` | Sits beside the three `orden_servicio` reads already there and inherits their `queryFn` seam. The page imports it — pages are this repo's composition layer |
| SEAM integrity check | inline in `customers/vehicles.ts` on `tx` | It **must** run on the transaction handle. A `service-orders/queries.ts` function closes over `db`, not `tx`, so it physically cannot be reused here |
| Vehicle identity | `listVehiculosByCliente(clienteId, {includeInactive:true})` | Already exists, already the sole owner, already returns inactive rows the spec needs |

**Rejected**: putting the history read in `customers/queries.ts` beside `getClienteById`'s
inline orders query (what explore.md's wording implies). It would give `customers`' read model
a second `orden_servicio` concern that no customer screen consumes, and buys nothing — the
proposal's actual closed decision was *no `customers → service-orders` module edge*, which
both options satisfy.

**Rejected**: `customers/vehicles.ts` importing from `@/modules/service-orders/*`. The SEAM
imports the `ordenServicio` **table** from `@/shared/db/schema`, which every module already
does; `schema.ts` imports nothing from `modules/`, so no cycle and no new edge.

### D2 — The vehicle picker: fetch on customer change, and clear the selection in the same handler

`CustomerPicker`'s `onSelect` hands `ServiceOrderForm` a whole `ClienteListItem`, but the form
keeps only `.id` (`ServiceOrderForm.tsx:194`). Supplying vehicles *with* the customer is
therefore tempting — and wrong, for a reason found in the code:

- `ClienteListItem.plates` is `string[]` — plate **strings**, built by `platesSubquery()`'s
  `array_agg`. No vehicle ids. The picker cannot name a vehicle.
- `CustomerPicker.tsx:210` can create a customer inline, and `onSaved(cliente, plates)` carries
  only plates because the 201 returns just the `cliente` row. A customer created inside the
  picker would have **no vehicle ids at all**. Supply-with-customer is broken by construction
  for that path.

**Choice**: fetch on customer change, through a new `GET /api/customers/[id]/vehicles` →
`listVehiculosByCliente(id)` (active-only default), gated by `customers.read`.

> **Gap neither explore.md nor the proposal caught**: `/api/customers/[id]` is **PATCH-only**
> (`src/app/api/customers/[id]/route.ts` — no GET exists). Any client-side vehicle list needs
> new API surface. This route is WU1 scope and is not in the proposal's affected-areas table.

**Rejected**: widening `platesSubquery()` to `array_agg` of json objects with ids. Changes
D4's SQL, `identifierFor`, and `customers/page.tsx`, still fails the create-inside-picker path,
and loads vehicles for 50 customers per keystroke-debounced search.

**Rejected**: a full `GET /api/customers/[id]` returning `ClienteDetail`. It would ship the
customer's whole order history and inactive vehicles to a client that needs neither.

**The stale-vehicle defect, closed explicitly.** `onSelect` becomes
`setClienteId(customer.id); setVehiculoId("")` — the clear is in the **same synchronous
handler** as the customer change, so no render ever shows customer B with vehicle A selected,
regardless of fetch timing. The effect that fetches uses a `cancelled` cleanup flag so a slow
response for customer A cannot repaint over customer B (`CustomerPicker`'s `abortRef` is the
same guard; a flag is smaller here because we only need to ignore the response).

**Zero vehicles blocks submission through the mechanism that already exists**: the submit
button is `disabled={isSubmitting || (!isEdit && !clienteId)}` today; it becomes
`|| (!isEdit && !vehiculoId)`. A customer with no active vehicles leaves `vehiculoId === ""`,
so the button is already dead — no new gate. Beside it, a directive Spanish message renders
when `clienteId && !loading && vehicles.length === 0`. `createOrder` refuses server-side
regardless.

Vehicle picker sits behind `!isEdit &&` (vehicle is immutable post-creation, like customer and
parts); the three notes sit behind `isEdit &&`; `categoria` renders in **both** modes.

### D3 — Store unaccented Spanish slugs, because `roleEnum` already does

**Two corrections to the framing first.** `StatusBadge` does **not** map stored values to
Spanish — it takes a `label` prop and maps status only to colour and icon
(`StatusBadge.tsx:80`). The Spanish lives in five hand-maintained call-site copies:
`ORDER_STATUS_LABEL` in `service-orders/[id]/page.tsx:26`, `service-orders/page.tsx:20` and
`customers/[id]/page.tsx:25`, plus `OrderStatusControls.tsx:10` and
`ServiceOrderFilters.tsx:11`. And `orderStatusEnum` is not the governing precedent: **`roleEnum`
is `pgEnum("role", ["tecnico", "administrador"])`** (`schema.ts:12`) — the repo already stores a
Spanish domain vocabulary, lowercase and **unaccented**.

**Choice**: `pgEnum("orden_categoria", ["instalacion", "mant_preventivo", "mant_correctivo",
"reparacion", "revisado"])`, with one `CATEGORIA_LABEL` map in a new
`src/modules/service-orders/categories.ts` (mirroring `transitions.ts`'s
`(typeof enum.enumValues)[number]` idiom) rendering `Instalación`, `Mant. Preventivo`,
`Mant. Correctivo`, `Reparación`, `REVISADO`.

**Rejected — English slugs** (`installation`/`preventive_maintenance`/…/`inspection`):
`REVISADO → inspection` is a lossy translation of a Panamanian legal artifact the spec spent a
requirement establishing (ATTT, *Certificado de Inspección Vehicular*). Translating away the
one term whose specificity is the point defeats the requirement.

**Rejected — the display strings verbatim** (`"Mant. Preventivo"`, `"Instalación"`): accents
and a period inside a stored enum value, and a Spanish string literal in every TS comparison —
against AGENTS.md's "identifiers stay English" for the one thing that *is* an identifier. It
also welds the stored value to display copy, so re-wording a label becomes an enum migration.

**Rationale**: the slug is an identifier (ASCII, lowercase, snake — exactly the shape of every
other enum in `schema.ts`), the *word* stays Spanish and untranslated, and the audience split in
AGENTS.md is honoured on both sides. This is not a compromise; `tecnico` (not `técnico`) is
precisely this rule already applied.

**This is permanent the moment real orders exist.** Postgres enums grow additively
(`ALTER TYPE … ADD VALUE`, precedent `0006`), but renaming or removing a value needs a
hand-written migration — drizzle-kit cannot infer an enum-value rename (recorded in
`archive/crm-shell-settings-rbac/proposal.md:78`, which is why `roleEnum`'s rename was authored
by hand). Treat the value set as append-only from the first inserted row.

Follow-up (not scoped): the five duplicated `ORDER_STATUS_LABEL` copies should collapse into one
shared map. Out of scope per AGENTS.md's "do not expand scope silently".

### D4 — The SEAM, exactly as C3 specified it

Read verbatim at `customers/vehicles.ts:269–287`. Implemented immediately above the DELETE,
inside the same `tx`:

```ts
if (plan.delete.length > 0) {
  const blocked = await tx.select({ id: ordenServicio.id }).from(ordenServicio)
    .where(inArray(ordenServicio.vehiculoId, plan.delete)).limit(1);
  if (blocked.length > 0) {
    throw new ClienteValidationError({
      vehicles: "No se puede eliminar un vehículo con órdenes de servicio. Desactivalo en su lugar.",
    });
  }
  await tx.delete(vehiculo).where(...);   // unchanged
}
```

- **Inside the transaction**, per the comment's own reasoning: `planVehiculoReconcile` is pure
  and cannot read, and a check outside would race an order created between check and DELETE.
- **`TxLike` already is `Pick<typeof db, "insert"|"update"|"delete"|"select">`**
  (`vehicles.ts:54`) — `select` was added by C3 for this. No type change.
- **The asymmetry is structural, not conditional**: the check guards `plan.delete` only.
  `plan.deactivate` (L262) is untouched, so a vehicle with history stays soft-deletable, and
  `getClienteById`/`listVehiculosByCliente({includeInactive:true})` keep returning it, so an
  order pointing at a deactivated vehicle still renders its identity and link.
- The `vehicles` key reuses the 400 shape `CustomerForm` already renders — same key
  `planVehiculoReconcile:193` throws under. No payload, form, or route change.
- `limit(1)` because the decision is boolean; the message names no ids (they are UUIDs, useless
  to a human reading a form error). `ponytail:` list the blocking plates only if staff ask.

**Rejected**: relying on `ON DELETE RESTRICT` alone. It produces a raw FK 500, not Spanish
copy — it stays as the backstop for any path that bypasses `applyVehiculoPlan`.

### D5 — Plain `drizzle-kit generate`, never `--custom`

**Choice**: `npx drizzle-kit generate --name order_vehiculo_category_notes` → `0015_*.sql`
(latest on disk is `0014_drop_cliente_vehicle_columns.sql`, verified).

**Rejected**: `--custom`. It clones the previous snapshot instead of diffing `schema.ts`, so
`meta/0015_snapshot.json` would describe a schema without the new columns and every later
`generate` would re-emit them. `--custom` is only for SQL with no `schema.ts` representation —
`0012_enable_unaccent.sql` is the sole legitimate use here.

> **Correction to the brief**: this rule is recorded in
> `openspec/changes/archive/2026-09-01-vehicles-one-to-many/tasks.md:94`, **not** in AGENTS.md
> and **not** in C3's `design.md`. The substance is right; the sourcing was not.

Contents: the enum type, `vehiculo_id text NOT NULL` + FK `restrict`, three nullable `text`
columns, `categoria` NOT NULL with **no default** (no category is a safe default — silently
mis-filing an order is worse than forcing a choice), and
`index("orden_vehiculo_created_idx").on(vehiculoId, createdAt)` — the exact mirror of the
existing `orden_cliente_created_idx`, serving the history query's `WHERE … ORDER BY created_at
DESC`, the SEAM's `inArray`, and `ON DELETE RESTRICT`'s per-delete referencing scan (C3's own
argument for `vehiculo_cliente_idx`).

`ADD COLUMN … NOT NULL` with no default is valid **only** because the table is empty.
**Re-run `select count(*) from orden_servicio` immediately before generating**; read what
drizzle-kit emits rather than assuming it.

### D6 — Vehicle route: nested, two reads, zero duplicated detail

`src/app/(app)/customers/[id]/vehicles/[vehicleId]/page.tsx` — nested because `vehiculo` has no
independent lifecycle and no list route.

```
params {id, vehicleId}
   ├─ getClienteById(id)               → cliente (breadcrumb) + vehicles[] (includeInactive)
   │     └─ vehicles.find(vehicleId)   → identity; not found ⇒ notFound()
   └─ listOrdenesByVehiculo(vehicleId) → history, desc(createdAt)
```

Finding the vehicle inside the customer's own collection is what makes a mismatched
`/customers/A/vehicles/<B's vehicle>` a 404 — the ownership check is free, not extra code. And
`includeInactive: true` is what satisfies "a deactivated vehicle's screen must still render".

**Rejected**: a new `getVehiculoById` in `vehicles.ts`. It would still need a separate ownership
check against the URL's customer id, so it is more code for less safety.

Renders: Breadcrumb (Clientes → name → plate), an identity Card (plate badge, make/model/year
chips — reusing `customers/[id]/page.tsx`'s `PLATE_BADGE`/`CHIP`), and a history Table copied
from that same page (Estado / Categoría / Descripción / Cita / Creada / **Ver**), whose "Ver"
links to `/service-orders/[id]`. The order detail page is **not** duplicated. Empty state reuses
that page's `ClipboardList` block.

Vehicle cards on `customers/[id]/page.tsx` become links — **both** the active card and the muted
deactivated row, keeping the weight distinction C3 deliberately chose.

`ponytail:` `getClienteById` over-fetches the customer's whole order list for a breadcrumb name;
acceptable at this scale and identical to what the customer detail page already does. Add a
narrow name read if a customer ever has enough orders to notice.

## Data Flow

    ServiceOrderForm ─ CustomerPicker.onSelect ─▶ setClienteId + setVehiculoId("")
              │                                          │
              │                          GET /api/customers/[id]/vehicles (active only)
              │                                          │
              └─ POST /api/service-orders ─▶ createOrder ─┴─ clienteDetail.vehicles.find(vehiculoId)
                                                  │              └─ miss ⇒ Spanish 400 {errors.vehiculoId}
                                                  └─ tx: orden + items

    CustomerForm ─ vehicles[{deleted:true}] ─▶ updateCliente ─▶ tx ─▶ applyVehiculoPlan
                                                                        └─ SEAM select ⇒ 400 {vehicles}

    /customers/[id]/vehicles/[vehicleId] ─┬─ getClienteById → identity
                                          └─ listOrdenesByVehiculo → rows ─▶ /service-orders/[id]

## File Changes

| File | WU | Action | Description |
|---|---|---|---|
| `src/shared/db/schema.ts` (+`.test.ts`) | 1 | Modify | `vehiculoId`, `ordenCategoriaEnum`, 3 note columns, `orden_vehiculo_created_idx` |
| `src/shared/db/migrations/0015_*.sql` + `meta/` | 1 | Create | Generated, never hand-edited |
| `src/modules/service-orders/service.ts` (+`.test.ts`) | 1,2 | Modify | Ownership check + `InvalidVehiculoError` (1); widened `UpdateOrdenServicioPatch` (2) |
| `src/app/api/customers/[id]/vehicles/route.ts` (+`.test.ts`) | 1 | **Create** | `GET`, `customers.read`, active-only — the gap D2 found |
| `src/modules/customers/vehicles.ts` (+`.test.ts`) | 1 | Modify | Fill the SEAM |
| `src/modules/service-orders/ServiceOrderForm.tsx` (+`.test.tsx`) | 1,2 | Modify | Vehicle picker + reset (1); category select, notes in edit mode (2) |
| `src/e2e/full-flow.e2e.test.ts` | 1,3 | Modify | Extends the existing `vehicle search (E2E)` describe |
| `src/modules/service-orders/categories.ts` (+`.test.ts`) | 2 | Create | `ServiceCategory` type + `CATEGORIA_LABEL` |
| `src/app/api/service-orders/[id]/route.ts` (+`.test.ts`) | 2 | Modify | Whitelist `categoria`+3 notes into the patch |
| `src/app/(app)/service-orders/[id]/page.tsx` | 2 | Modify | Vehicle link, category, note rows |
| `src/modules/service-orders/queries.ts` (+`.test.ts`) | 3 | Modify | `listOrdenesByVehiculo` |
| `src/app/(app)/customers/[id]/vehicles/[vehicleId]/page.tsx` | 3 | Create | The vehicle screen |
| `src/app/(app)/customers/[id]/page.tsx` | 3 | Modify | Cards become links |

## Interfaces / Contracts

```ts
// service-orders/service.ts
export class InvalidVehiculoError extends Error {           // → 400 { errors: { vehiculoId } }
  constructor(readonly errors: { vehiculoId: string }) { super("Invalid vehiculo"); }
}
export type CreateOrdenServicioInput = { /* … */ vehiculoId: string; categoria: ServiceCategory };
export type UpdateOrdenServicioPatch = {
  description?: string | null; appointmentAt?: Date | null;
  categoria?: ServiceCategory;
  hallazgos?: string | null; recomendaciones?: string | null; observaciones?: string | null;
};
// service-orders/queries.ts
export async function listOrdenesByVehiculo(
  vehiculoId: string, queryFn?: () => Promise<OrdenServicio[]>): Promise<OrdenServicio[]>;
```

**`hallazgos` must never enter `CreateOrdenServicioInput`.** `POST /api/service-orders` passes
the raw `body` straight to `createOrder` (`route.ts:18`) with **no whitelist** — the only thing
satisfying the spec's "ignore `hallazgos` at creation" scenario is `createOrder`'s explicit
`.values({…})` map. Adding the notes to the create input silently breaks that scenario.

**Ownership check reuses data already in hand**: `createOrder` already calls
`getClienteById(input.clienteId)` at L156–157, and `ClienteDetail.vehicles` is populated with
`includeInactive: true`. The check is an array lookup — zero extra queries, zero new imports.
It accepts only vehicles with `deactivatedAt === null`, matching what the picker can offer;
the spec is silent on inactive-at-create, so this is a deliberate tightening (alternative:
accept inactive — rejected, you cannot book work on a car the customer no longer has).

## Testing Strategy

Strict TDD, RED first. Every `src/modules/*` unit test injects its seam, so **a green
`npm test` proves zero real-SQL coverage** (AGENTS.md). The split below is the whole point.

| Layer | What | How |
|---|---|---|
| Unit | Ownership rejection: unknown id, customer-B's vehicle, inactive vehicle | Inject `deps.getClienteById`; pure array logic |
| Unit | SEAM **refuses** when orders exist | Fake `TxLike` whose `select()` returns one row → `ClienteValidationError` |
| Unit | SEAM **allows** when none exist, and never runs for `deactivate`-only plans | Fake `TxLike`; assert `select` uncalled |
| Unit | Widened `updateOrder` patch round-trip; PATCH route whitelist | Existing fake-db shape |
| Unit | `CATEGORIA_LABEL` covers every `enumValues` entry | Mirrors `schema.test.ts:90` |
| Component | **Changing customer clears the vehicle** | `.test.tsx`, jsdom — the defect D2 exists to prevent |
| Component | Zero-vehicle directive message + disabled submit; notes absent in create, present in edit | jsdom |
| **E2E** | `vehiculo_id` NOT NULL rejects an order without one | Real PG — unit tests cannot reach it |
| **E2E** | FK rejects a nonexistent `vehiculo_id`; `RESTRICT` blocks a raw vehicle delete | Real PG |
| **E2E** | SEAM: `deleted:true` on a vehicle with history → Spanish 400, row survives | Through `PATCH /api/customers/[id]` |
| **E2E** | Asymmetry: same vehicle `deactivated:true` → 200, history still queryable | Real PG |
| **E2E** | Two vehicles, one customer: history returns only the queried vehicle's orders | Real PG |

E2E extends the existing `vehicle search (E2E)` describe (`src/e2e/full-flow.e2e.test.ts:261`),
which already runs `execSync("npx drizzle-kit migrate")` in `beforeAll` — so `0015` is exercised
by running the suite. Export `DATABASE_URL` at the throwaway Postgres (port 5433); `npm test`
excludes `src/e2e/**`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The e2e's pre-existing `execSync("npx drizzle-kit migrate")` is
unchanged test infrastructure taking no new input.

## Migration / Rollout

| WU | Est. lines | Revertible |
|---|---|---|
| 1 — schema + `0015` + ownership + `GET …/vehicles` + picker + SEAM + e2e | 420–470 | Forward-only companion drops the five columns + the enum type |
| 2 — category enum labels, notes, widened patch, order detail rows | ~300 | Yes, code-only |
| 3 — vehicle route + history read + clickable cards | ~280 | Yes, code-only |

WU1 is **above** the proposal's ~400 estimate: the `GET /api/customers/[id]/vehicles` route and
its test were not in the proposal's affected-areas table. Still under the 400-line *review*
budget only if the e2e block is counted separately — flag at apply time rather than widening
silently (`ask-on-risk`).

Rollback is safe precisely because the table is empty; that safety expires with the first real
order. `ON DELETE RESTRICT` + `cliente`'s existing `restrict` mean the `vehiculo` cascade can
never orphan an order.

## Open Questions

- [ ] **Spec conflict.** "A field not yet set MUST render an explicit empty-state placeholder,
      never a blank row" contradicts `field()` at `service-orders/[id]/page.tsx:52`, which
      returns `null` — it renders **no row** for an empty value. Planned resolution: pass
      `orden.hallazgos ?? "—"` (the placeholder `customers/[id]/page.tsx` already uses in
      tables) rather than adding a `field()` variant. Confirm "—" is the wanted placeholder.
- [x] **C3 archive dependency — resolved.** The proposal flagged that C3 was unarchived and
      `openspec/specs/customer-management/spec.md` still described the pre-C3 model. It is now
      archived (`archive/2026-09-01-vehicles-one-to-many/`) and that spec carries the full
      *Vehicle Collection Persistence, Soft Delete, and Permanent Deletion* requirement at
      L66. C4's delta stacks cleanly; no special handling needed.
