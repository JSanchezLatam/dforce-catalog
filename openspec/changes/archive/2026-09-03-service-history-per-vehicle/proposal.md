# Proposal: Service History per Vehicle (C4)

## Intent

A customer's vehicles are a flat, unclickable card list, and `orden_servicio` has no
`vehiculo_id` — so a two-car customer's history is one undifferentiated pile. The
workshop cannot answer "what has been done to *this* car". C4 binds every order to
one vehicle and gives the vehicle its own screen.

Two things make now the right moment: `orden_servicio` holds **0 rows** (verified
live against the dev database on 2026-09-01; nothing is deployed anywhere, so the
dev DB is the only one), which is the window in which `vehiculo_id` can be `NOT NULL`
with no backfill; and PR #52 already shipped permanent vehicle deletion, so the FK
and its integrity check must land together.

## Scope

### In Scope

| Deliverable | Note |
|---|---|
| `orden_servicio.vehiculo_id` — FK to `vehiculo`, **NOT NULL**, `ON DELETE RESTRICT` | 0 rows, no backfill; migration `0015` (latest on disk is `0014`) |
| `orden_servicio.categoria` — `pgEnum`, five values including REVISADO | same shape as the existing `orderStatusEnum` precedent |
| `hallazgos`, `recomendaciones`, `observaciones` — nullable text | written at **completion**, not at booking |
| `createOrder` validates the vehicle exists **and belongs to** `input.clienteId` | order and vehicle must agree on their customer |
| **Fill the pre-planted SEAM** in `customers/vehicles.ts#applyVehiculoPlan` (~L269) | non-negotiable — see Approach |
| Widen `updateOrder` to patch category + the three notes | today it patches only `description`/`appointmentAt`; `transitionOrder` owns status |
| `ServiceOrderForm`: vehicle picker scoped to the chosen customer, category select; notes in **edit** mode only | the form has zero vehicle awareness today |
| New route `customers/[id]/vehicles/[vehicleId]/page.tsx` + its history read | nested: `vehiculo` has no independent lifecycle |
| `customers/[id]/page.tsx` vehicle cards become links; `service-orders/[id]/page.tsx` gains vehicle + category + note rows | |
| e2e coverage for the FK, the NOT NULL and the SEAM refusal | unit tests inject their seam and prove nothing about real SQL (AGENTS.md) |

### Out of Scope — with reasons

- **Annual *revisado* reminder.** REVISADO is Panama's mandatory yearly ATTT
  inspection, so a customer serviced today legally needs another in ~12 months —
  a real follow-up, but not this change. `reminders` already has a `service_due`
  kind, yet `planReminders` computes it as `completedAt + SERVICE_DUE_AFTER_DAYS`,
  one global constant. A per-category interval is a schedule change, not a config
  tweak. **Recorded as follow-up #1 so it is not lost.**
- **Everything the reference designs show that no column backs**: photo wells,
  mileage, cost-percentage rings, expense charts, fleet dashboards. All four images
  in `Insumos/Templates/Customer_and_Cars_detail_UI_Design/` are a **layout**
  reference (master-detail, identity block, history rows with a detail affordance);
  none is workshop-shaped. Reading them as a specification is this change's main
  scope-creep risk.
- **Giving `orden_servicio` a single owning module.** That would add a
  `customers → service-orders` edge alongside the existing reverse one — the
  bidirectional coupling `vehicles.ts`'s docstring exists to prevent.
- **Making `vehiculo` a top-level entity** (its own list route, cross-customer
  search). No request, no lifecycle to justify it.
- **Stock deduction, pricing, invoicing** — standing repo decision (AGENTS.md).
- **Editing an order's vehicle after creation.** Customer and parts are already
  immutable post-creation by `ServiceOrderForm`'s stated design; the vehicle joins
  them. Cheaper to add later than to un-ship.

## Closed decisions (do not re-open)

1. **`vehiculo_id` is NOT NULL.** `select count(*) from orden_servicio` → **0**,
   verified 2026-09-01. Re-verify only if the migration is written days later.
2. **REVISADO stays in the category enum.** The exploration flagged it as a
   possible status-in-a-type-vocabulary smell. **That flag was wrong and is now
   retired.** The *revisado vehicular* is Panama's mandatory annual ATTT technical
   inspection, a legal prerequisite for renewing the `placa`, issuing a
   *Certificado de Inspección Vehicular*, costing roughly $15–25. It is a service
   the workshop performs and charges for, exactly like the other four: a **type**,
   not a state. Its only genuine asymmetry — it is annual and recurring — is
   captured as follow-up #1, not as scope.
3. **Notes are written at completion.** You cannot record *hallazgos* before you
   have looked at the car. They are absent from the create dialog and present in
   edit mode, which is why `updateOrder` has to widen.

## Approach

**Extend the existing `service-orders → customers` dependency; invent nothing.**
That direction is already production reality: `service-orders/service.ts` imports
`getClienteById`, and `customers/queries.ts` already imports `ordenServicio` and
queries it inline (L100–104). The picker imports `listVehiculosByCliente` from
`customers/vehicles.ts`; the vehicle history reads `orden_servicio` by `vehiculoId`
exactly as `getClienteById` reads it by `clienteId`. Zero new module edges.

**The SEAM is a correctness requirement, not a nicety.** `applyVehiculoPlan`'s
comment at ~L269 already specifies it: `select` over `orden_servicio` for
`inArray(ordenServicio.vehiculoId, plan.delete)` **inside the same `tx`**, throwing
`ClienteValidationError({ vehicles: "…" })` — a 400 `CustomerForm` already renders.
Inside the transaction because the reconcile is pure and cannot read, and a check
outside would race an order created between the check and the DELETE.
`ON DELETE RESTRICT` is the backstop; this check is what makes it Spanish copy
instead of a 500. `TxLike` already exposes `select`; no payload or form shape changes.

Note the asymmetry the SEAM must preserve: it guards `plan.delete` only.
**Deactivating** a vehicle that has history stays allowed (soft delete, history
intact); only permanent deletion is refused. An order pointing at a deactivated
vehicle must still render.

FK interaction is already safe: `vehiculo.clienteId` is `ON DELETE CASCADE`, but
`ordenServicio.clienteId` is `RESTRICT`, so a customer with orders cannot be deleted
in the first place — the cascade can never orphan an order.

## Capabilities

### New Capabilities

None. The vehicle screen belongs to `customer-management` (which owns `vehiculo`);
the order's vehicle, category and notes belong to `service-orders`.

### Modified Capabilities

- `service-orders`: orders MUST name exactly one vehicle belonging to the order's
  customer; orders carry a category and three completion-time note fields, editable
  after creation.
- `customer-management`: a vehicle has a detail view listing its own service history
  (most-recent-first, with an empty state); permanent deletion of a vehicle with
  service history MUST be refused with a Spanish 400.

**Dependency the spec phase must handle:** `openspec/changes/vehicles-one-to-many`
(C3) is **not archived**. The requirement C4 modifies — *Vehicle Collection
Persistence and Soft Delete* — exists only in that change's unmerged delta;
`openspec/specs/customer-management/spec.md` still describes the pre-C3
single-vehicle-columns model (R17 still says "make without plate"). C4's delta
stacks on C3's, and either C3 archives first or the delta must say so explicitly.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/shared/db/schema.ts` | Modified | `vehiculoId`, category enum, three note columns, index on `vehiculo_id` |
| `src/shared/db/migrations/0015_*.sql` | New | FK + NOT NULL + enum + columns |
| `src/modules/service-orders/service.ts` | Modified | vehicle validation in `createOrder`; widened `updateOrder` patch |
| `src/modules/service-orders/queries.ts` | Modified | history-by-vehicle read |
| `src/modules/service-orders/ServiceOrderForm.tsx` | Modified | vehicle picker, category select, notes in edit mode |
| `src/app/api/service-orders/**` | Modified | request schemas for the new fields |
| `src/modules/customers/vehicles.ts` | Modified | fill the SEAM |
| `src/app/(app)/customers/[id]/vehicles/[vehicleId]/page.tsx` | New | vehicle screen |
| `src/app/(app)/customers/[id]/page.tsx` | Modified | cards become links |
| `src/app/(app)/service-orders/[id]/page.tsx` | Modified | vehicle/category/note rows |
| tests | Modified/New | `service.test.ts`, `ServiceOrderForm.test.tsx`, both `queries.test.ts`, `vehicles.test.ts`, e2e |

## Delivery forecast — over budget, slice it

**The honest forecast is ~950–1,050 changed lines, against a stated 800-line budget
(`ask-on-risk`).** Saying so up front: C3's slice 3 blew past its budget and had to
flag it after the fact. Recommended slicing, each unit under the repo's 400-line PR
review budget, delivered as a feature branch chain (AGENTS.md):

| WU | Content | Est. |
|---|---|---|
| 1 | schema + migration + `createOrder` vehicle validation + form vehicle picker + **the SEAM** + e2e | ~400 |
| 2 | category enum + three notes, widened `updateOrder`, order-detail rows | ~300 |
| 3 | vehicle detail route + history read + clickable cards | ~280 |

WU1 is deliberately the largest: NOT NULL and the picker cannot ship apart without
leaving order creation broken, and the SEAM cannot ship after the FK. WU2 and WU3
are independent of each other.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| FK ships without the SEAM → deleting a vehicle with history is a raw 500 | Med | SEAM is inside WU1, with an e2e case |
| Green suite mistaken for verified SQL — every `src/modules/*` unit test injects its seam, so the FK/NOT NULL/SEAM branches never execute | **High** | e2e against a real Postgres is a WU1 exit criterion, not a follow-up |
| Reference-design scope creep | Med | named out of scope above, per artifact |
| `orden_servicio` row count changes before the migration is written | Low | re-run the count immediately before writing `0015` |
| C3 delta not archived → C4 spec stacks on unmerged text | Med | flagged for the spec phase above |
| Chain grows past three PRs | Med | `ask-on-risk`: stop and ask rather than silently widening a slice |

## Rollback Plan

Per work unit, all pre-merge to `main` (the chain's tracker is the only thing that
merges): revert the branch. The migration needs a forward-only companion — this repo
has no down migrations — dropping `vehiculo_id`, `categoria` and the three note
columns plus the enum type. Safe precisely because the table is empty; that safety
expires once orders exist, which is the strongest argument for doing this now. The
SEAM reverts to its comment; nothing else depends on it.

## Dependencies

- `openspec/changes/vehicles-one-to-many` (C3) merged — `vehiculo`, migration `0013`,
  `listVehiculosByCliente`, and the SEAM itself all come from it.
- PR #52 (permanent vehicle deletion) is already shipped — it is what makes the SEAM
  urgent rather than theoretical.
- A reachable Postgres for `src/e2e/**` (excluded from `npm test`).

## Follow-ups (recorded, not scoped)

1. **Annual *revisado* reminder** — a `service_due` reminder ~12 months out for
   REVISADO orders. Needs a category-aware interval in `reminders/schedule.ts`;
   `SERVICE_DUE_AFTER_DAYS` is currently one global constant.
2. Editing an order's vehicle after creation, if the workshop ever mis-files one.
3. Exact-plate index on `vehiculo.plate`, if the vehicle screen ever gets a
   plate lookup (the schema comment already anticipates this).

## Success Criteria

- [ ] Creating an order requires a vehicle, and the picker offers only that
      customer's active vehicles.
- [ ] Rejecting a vehicle that belongs to a different customer returns a Spanish 400,
      not a 500.
- [ ] Deleting a vehicle with service history returns a Spanish 400 from the SEAM
      check; deactivating the same vehicle still succeeds and keeps its history.
- [ ] A vehicle's detail screen lists its own orders, most-recent-first, with an
      empty state when it has none.
- [ ] Category and the three note fields round-trip: absent at creation, editable
      afterwards, rendered on the order detail.
- [ ] `npm test` and `npx tsc --noEmit` clean; e2e proves the FK, the NOT NULL and
      the SEAM against a real Postgres.
