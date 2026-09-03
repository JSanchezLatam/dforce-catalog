# Explore: service-history-per-vehicle (C4)

The owner's third reported defect: a customer's vehicles are a flat, unclickable
list, and nothing records which car a service order was for. This change gives a
vehicle its own screen and its own history.

## Current state

`ordenServicio` (`src/shared/db/schema.ts` ~L318) has **no `vehiculoId`** —
verified, zero hits in `src` outside one forward-looking comment. Its columns:
`id`, `clienteId` (notNull, `onDelete: restrict`), `status` (enum),
`description` (its only free-text field), `appointmentAt`, `completedAt`,
`createdBy`, timestamps.

**Create**: `ServiceOrderForm.tsx` → POST `/api/service-orders` →
`service-orders/service.ts#createOrder`, which validates `clienteId` through
`getClienteById` and inserts the order plus its `orden_servicio_item` rows in
one transaction, then schedules reminders. Nothing about vehicles touches this
path.

**Edit**: PATCH `/api/service-orders/[id]` → `updateOrder`/`transitionOrder`,
which only ever patch `description`/`appointmentAt`/`status`. Customer and parts
are immutable after creation, by `ServiceOrderForm`'s own stated design.

**Detail**: `src/app/(app)/service-orders/[id]/page.tsx` — Breadcrumb plus Cards
(header/fields, parts table, reminders table), sharing the `field()` and
`StatusBadge` idiom with `customers/[id]/page.tsx`.

**Vehicles**: `cliente` → `vehiculo` one-to-many since C3 (migration `0013`).
`customers/vehicles.ts` is the declared sole owner of `vehiculo` reads and
writes (its D3 "one owner" rule). Vehicles render as a flat, non-clickable card
list in `customers/[id]/page.tsx`, which that file's docstring already names as
deferred master-detail work.

## Two findings that shape the whole change

### 1. C3 pre-planted the integrity check this change needs

`vehicles.ts#applyVehiculoPlan` (~L269) carries a `// SEAM` comment written when
C3 shipped, specifying exactly what C4 must add:

> the referential-integrity check goes HERE, immediately above this statement,
> when `orden_servicio` gains its `vehiculo_id` FK … `select` over
> `orden_servicio` for `inArray(ordenServicio.vehiculoId, plan.delete)` inside
> this same `tx`, and throw `ClienteValidationError({ vehicles: "..." })` … doing
> it in the transaction rather than in `planVehiculoReconcile` is deliberate: the
> reconcile is pure and cannot read, and a check outside the transaction would
> race an order created between the check and the DELETE.

This is **load-bearing, not optional**. PR #52 shipped permanent vehicle
deletion. The moment `vehiculo_id` exists, deleting a vehicle that has service
history must produce a Spanish 400 — not a raw Postgres FK error. `ON DELETE
RESTRICT` is the backstop; this check is what turns it into copy a human reads.

### 2. The module boundary this change needs already exists

`vehiculo` has a strict single-owner rule. `orden_servicio` **does not**, and
that asymmetry is already production reality:

- `customers/queries.ts#getClienteById` already imports `ordenServicio` from
  `schema.ts` and queries it inline.
- `service-orders/service.ts` already imports `getClienteById` from
  `customers/queries.ts`.

So the `service-orders → customers` direction already exists, and reading
`orden_servicio` from `customers` is already the established precedent. C4 needs
**no new architectural decision** here — only the discipline not to invent one.

## Affected areas

| Area | Change |
|---|---|
| `shared/db/schema.ts` | `vehiculoId` (FK, NOT NULL), a category enum, and the three note fields on `ordenServicio`; new migration after `0014` |
| `service-orders/service.ts` | `createOrder` validates the vehicle exists AND belongs to the named customer; decide whether category/notes are patchable after creation |
| `service-orders/ServiceOrderForm.tsx` | vehicle picker scoped to the chosen customer, category `Select`, three note fields — today it has zero vehicle awareness |
| `customers/vehicles.ts` | fill in the pre-planted SEAM |
| `service-orders/[id]/page.tsx` | category + three note rows; vehicle field linking to the new route |
| **new** `customers/[id]/vehicles/[vehicleId]/page.tsx` | the vehicle screen — nested under its customer, since `vehiculo` has no independent lifecycle and no list page of its own |
| `customers/[id]/page.tsx` | vehicle cards become links |
| one new read | vehicle + its `orden_servicio` history |
| tests | `service.test.ts`, `ServiceOrderForm.test.tsx`, both `queries.test.ts`, `vehicles.test.ts` — strict TDD |

## Decisions and open questions

**`vehiculo_id` NOT NULL — decided by the owner, and the window is confirmed
open.** `select count(*) from orden_servicio` returned **0**, verified live
against the dev database on 2026-09-01, immediately before this document. Nothing
is deployed anywhere, so the dev database is the only one. No backfill, no
nullable-forever compromise. This is not open for re-litigation; it only needs
re-checking if the migration is written days later.

**Cross-module boundary — extend, do not invent.** `service-orders` imports
`listVehiculosByCliente` from `customers/vehicles.ts` for the picker (the
direction `service.ts` already uses); the history read queries `orden_servicio`
by `vehiculoId` the way `getClienteById` already queries it by `clienteId`. Zero
new edges. **Rejected**: giving `orden_servicio` a single owner and having
`customers` import from `service-orders` — that adds a `customers →
service-orders` edge alongside the existing reverse edge, which is the
bidirectional coupling `vehicles.ts`'s docstring exists to avoid.

**Categories — `pgEnum`.** `orderStatusEnum` is the existing precedent for a
small closed vocabulary, and this is the same shape: owner-specified, fixed, no
admin CRUD requested. A lookup table is unrequested scope; plain text throws away
drift protection for nothing.

**OPEN — does REVISADO belong in that enum?** Instalación, Mant. Preventivo,
Mant. Correctivo and Reparación all answer *what was done to the car*. REVISADO
answers *what state the order is in*. It is not a duplicate of `orderStatusEnum`
(open/in_progress/done/cancelled), but mixing a status into a type vocabulary is
the kind of modelling choice that becomes a data migration once real orders
exist. **Ask before the spec locks the enum.**

**OPEN — when are the notes written?** hallazgos/recomendaciones/observaciones
read as technician output produced at completion, not at booking. Whether they
also appear in the create dialog needs one line of confirmation.

## Reference designs — what actually transfers

All four images in `Insumos/Templates/Customer_and_Cars_detail_UI_Design/` were
reviewed. **None is workshop-shaped**: a Porsche marketplace inspection panel
with cost-percentage rings, a Salesforce-style invoicing dashboard, a car-rental
partner dashboard, and a fleet-management console.

What transfers is **structure**: master-detail layout, a vehicle identity block,
and a history section whose rows carry a detail affordance. `Custumer detail
3.jpg`'s "Routes → History" panel is the closest analog to what is being built.

What does **not** transfer, because no column backs any of it: photo wells,
mileage, cost percentages, expense rings, charts. Reading these as a
specification rather than as a layout reference is the scope-creep risk of this
change.

## Risks

- **The SEAM must be implemented in this change.** Vehicle deletion already
  ships (PR #52). Adding the FK without the check turns a normal user action
  into a 500.
- **REVISADO's ambiguity** is irreversible once real orders carry it — the same
  class of decision the owner already spent one answer on for `vehiculo_id`.
- **Reference-design scope creep** — see above.
- **`orden_servicio` row count** must be re-verified if the migration is not
  written promptly. Confirmed 0 on 2026-09-01.
- **The green-suite trap** (`AGENTS.md`): every unit test in `src/modules/*`
  injects its query seam, so a fully green `npm test` proves no real SQL ran. The
  FK, the NOT NULL and the SEAM check are all real-SQL behaviour — they need e2e
  coverage or they are untested.

## Ready for proposal

Yes, with one question carried forward: **does REVISADO belong in the category
enum?**
