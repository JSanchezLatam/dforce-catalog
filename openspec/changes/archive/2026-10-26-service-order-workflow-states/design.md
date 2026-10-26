# Design: Service Order Workflow States

## Technical Approach

Extend `order_status` in place; `open` is relabeled "Recibida". `ALLOWED_TRANSITIONS` becomes the full legal table from spec R21, automatic edges included. A small `AUTOMATIC_TARGETS` set (`diagnosing`, `ready_for_review`) is what keeps those targets out of the manual route, the status controls and bulk. Every status write goes through one helper, `setStatus`. It asserts the full table and writes the history row in the same transaction. Receiving a booked order is an ordinary manual transition (`booked → open`) on the existing PATCH route, so no endpoint is added. The work ships in two migrations because the chain needs two schema steps: 0033 adds the new states and 0034 relaxes nullability.

## Architecture Decisions

| # | Decision | Rejected | Why |
|---|---|---|---|
| D1 | **0033** (WU1): `CREATE TYPE espera_motivo ('repuesto','aprobacion_cliente')`; `ADD VALUE 'booked' BEFORE 'open'`, `'diagnosing' BEFORE 'in_progress'`, `'on_hold' BEFORE 'ready_for_review'`; table `orden_estado_historial`; column `orden_servicio.espera_motivo`; CHECK `orden_espera_motivo_on_hold`: `(espera_motivo IS NOT NULL) = (status::text = 'on_hold')`. **0034** (WU3): `DROP NOT NULL` on `vehiculo_id` and `categoria`; CHECK `orden_vehiculo_categoria_required`: `status::text IN ('booked','cancelled') OR (vehiculo_id IS NOT NULL AND categoria IS NOT NULL)` | One migration; literal enum comparison in the CHECK | Nullable columns in WU1 would cascade type errors into WU1. `migrate()` runs every pending file in ONE transaction (`scripts/migrate.mjs:23`, comment at `0029:41-43`), and the spike showed the literal form fails while `::text` passes. The resulting enum order matches spec R-labels (today: `schema.ts:239`), and the Estado sort follows it (`queries.ts:65-70`). |
| D1a | Write the CHECKs in `schema.ts` `check()` using `sql\`${table.status}::text …\``, so `npm run db:generate` emits them as written. The only hand edits: confirm `CREATE TYPE` comes before `ADD COLUMN`, and add a `--` comment explaining `::text` (as `0029:41-43` does). The journal and `meta/003x_snapshot.json` are generated and never edited | Hand-writing the whole SQL | This keeps the snapshot in sync with the schema. It matches the `0028` `ADD VALUE … BEFORE` precedent. |
| D2 | New `service-orders/set-status.ts`. `recordStatus(tx, row)` only inserts. `setStatus(tx, order, to, actor, extra?)` runs `assertTransition(order.status, to)` against the full table, then one UPDATE that always writes `espera_motivo` explicitly (so leaving `on_hold` clears it), then `recordStatus`. | A DB trigger; leaving writers unasserted (`readiness.ts:33-35` today) | The repo has no triggers. A single helper means no writer can skip either the history row or the legality check. |
| D3 | The actor is the user whose request caused the step: `createdBy` (create), `assignedBy` (assign), the marker `input.userId` (readiness via `parte-lista.ts:62`), and `user.id` (PATCH). `changed_by` uses `ON DELETE SET NULL`, like `createdBy` (`schema.ts:556`). The history FK to the order is `restrict`. | A system actor | Each automatic step is caused by a person. The spec requires the row to survive its actor. |
| D4 | `transitionOrder` (`service.ts:381-394`) refuses `AUTOMATIC_TARGETS` as `OrderTransitionError`. It requires `esperaMotivo` exactly when `to === "on_hold"`; it is missing, invalid or present for any other target → `EsperaMotivoError` → 400. For `booked → open` it refuses with `OrderIncompleteError` (400, Spanish) when the locked row's vehicle or category is null, so the CHECK never surfaces as a 500. It then continues to `diagnosing` when the order has at least one assignment. `isTransitionPermitted` becomes `canAssign` (removes `transitions.ts:67-69`) | A dedicated `/receive` endpoint | The spec makes the vehicle and category editable while booked, so receiving is only a status change. No new route and no `ROUTE_GUARDS` entry. |
| D5 | Vehicle and category are set while booked through the existing PATCH edit path. Add `vehiculoId` to the whitelist (`[id]/route.ts:66-111`). Inside `updateOrder`'s lock: if the status is not `booked`, refuse; otherwise check the vehicle (`vehiculo.id = $1 AND cliente_id = order.clienteId AND deactivated_at IS NULL`). `appointmentAt` is required for booked in `createOrder`, and clearing it on a booked order in `updateOrder` is refused. Both are service checks, not a CHECK. | A DB CHECK on `appointment_at` | A CHECK would answer 500 where a Spanish 400 is expected. The lock already reads the status. |
| D6 | Auto-diagnosing applies only to `open` with at least one assignment, at the end of `createOrder` (`service.ts:217-221`), `assignTecnico` (`assignments.ts:74-82`) and the booked → open receive. `booked` and `on_hold` keep their status when a technician is assigned. The row lock serializes concurrent first assignments, so `diagnosing` is written once. No unassign path exists (`assignments.test.ts:123`). | — | This covers the spec's Order Assignment effects exactly. |
| D7 | Hold UI: ONE button per reason ("Marcar como En espera (repuesto)" and "Marcar como En espera (aprobación del cliente)"). Success toasts use the spec's copy and sit above `router.refresh()` (`OrderStatusControls.tsx:65` has none today). Bulk menu: manual transitions minus `on_hold`. `booked`, `diagnosing` and `ready_for_review` are never manual targets anyway. | A reason dialog | Two buttons need no new component and meet the 44px rule. |
| D8 | Nullability: list and count switch to `leftJoin(vehiculo)` together (`queries.ts:173,201`). List item vehicle fields become `string \| null`. A new `categoriaLabel(c \| null)` in `categories.ts` returns "Sin categoría". It is used at `[id]/page.tsx:242`, `print/page.tsx:250,267` and `vehicles/[vehicleId]/page.tsx:166,187`. "Sin vehículo" goes at `[id]/page.tsx:224-232` and in the print plate fields. `schedule.ts:35` is keyed by `NonNullable<…>` and guarded at `:92`. | Fixing call sites one by one | One label function, and tsc lists every site. |
| D9 | Portal: `buildSnapshot` filters `status !== "booked" && vehiculoId !== null && categoria !== null`. `CUSTOMER_STATUS` is typed `Record<Exclude<OrderStatus,"booked">, …>`, so tsc forces the filter. `job.ts:97` stays an inner join. | Filtering in SQL alone | A pure filter can be unit-tested. A booked order that already has a vehicle gets past the inner join. |
| D10 | Fire-time guard in `runReminder` after `job.ts:222`: `type === "appointment" && orden.status !== "booked"` → `markSkipped`. | Planning reminders only for booked orders | Every check in `runReminder` runs at fire time (ADR-5). One rule in one place. |
| D11 | Policies: `EDITABLE` follows the spec table. `PHOTOS_CHANGEABLE` is `booked`/`open`/`diagnosing`/`in_progress` "all" and `on_hold`/`ready_for_review` "staff". `canWriteFor` (`work-lines.ts:104`, typed `OrderStatus`) is `diagnosing`/`in_progress`, plus `ready_for_review` for staff, and `workLineMode` mirrors it. `parte-lista.ts:45` already refuses `on_hold`. The metrics `BACKLOG_STATUSES` holds the 6 non-terminal states, and `fillBacklog` becomes a map over them. | — | These are exhaustive Records, so tsc forces every edit. |

## Data Flow

    PATCH {status, esperaMotivo} ─→ transitionOrder ─┐
    POST / ─→ createOrder (recordStatus, auto) ───────┼─→ setStatus(tx): assert ─→ UPDATE orden_servicio
    POST /assignments ─→ assignTecnico ───────────────┤                          └→ INSERT orden_estado_historial
    parte-lista ─→ applyReadiness(tx, order, actor) ──┘

## Interfaces

```ts
export const AUTOMATIC_TARGETS: ReadonlySet<OrderStatus>; // diagnosing, ready_for_review
export function getManualTransitions(from: OrderStatus): OrderStatus[];
export async function setStatus(
  tx: Tx, order: Pick<OrdenServicio, "id" | "status">, to: OrderStatus, actor: string | null,
  extra?: Partial<Pick<OrdenServicio, "esperaMotivo" | "completedAt">>,
): Promise<OrdenServicio>;
// TransitionOrdenServicioDeps gains: actorId: string; esperaMotivo?: EsperaMotivo
// applyReadiness(tx, order, actorId)
```

History table: `id` text uuid, `orden_id`, `from_status` (null on creation), `to_status`, `espera_motivo`, `changed_by`, and `changed_at`, which defaults to `clock_timestamp()` rather than `now()`. `now()` returns the same value for every row in a transaction, so the two rows written by one request would share a timestamp. Index on `(orden_id, changed_at)`. Nothing updates or deletes a row.

## Testing Strategy

| Layer | What |
|---|---|
| Unit (node) | The full table equals the R21 pairs; manual filter; permission (a técnico is refused everything); edit, photo and work-line policies; `buildSnapshot` exclusion, plus a parse with the portal parser; `runReminder` guard; route tests: reason 400s, incomplete-receive 400, booked create without a date 400, `vehiculoId` patch refused outside booked |
| jsdom | Status controls (two hold buttons, spec toasts, a técnico sees none); bulk omits on_hold; filter in workflow order with "Recibida"; six BacklogCounters; StatusBadge (booked is not `scheduled`) |
| e2e (real SQL) | Migration from 0032 with seeded rows, then 0033+0034 in ONE `migrate()` (copy `technicians-migration.e2e.test.ts:31-77`): CHECKs, `enum_range`, zero history rows. Every [e2e] scenario in the specs, especially: history per writer, atomicity, concurrent first assign, list/count parity, sort order, reminder guard |
| Browser (LAN IP) | Booked detail and print pages render (RSC boundary); hold buttons on a tablet |

Mutation-verify each fix: revert it and confirm the named test goes red. Specifically: drop `recordStatus`; drop `::text`; revert only the count to `innerJoin`; delete the snapshot filter; delete the guard; restore the técnico exception.

## Threat Matrix

N/A. No shell, subprocess, VCS automation, process integration or new route is added.

## Migration / Rollout — chained PRs (generated meta excluded)

| WU | Scope | ~Lines |
|---|---|---|
| 1 | 0033 and schema; the full transition table and `AUTOMATIC_TARGETS` (`transitionOrder` refuses those targets from this WU on), keeping `open → in_progress` and the técnico exception temporarily so the suite stays green; labels; badge; policies; portal mapping and filter; filter options, `VALID_STATUS`, metrics; migration e2e | 370 |
| 2 | `set-status.ts`; create, transition, readiness, assign and parte-lista through it; edge flip and exception removal; esperaMotivo; receive continuation; e2e setup changes in the 4 files that use `open → in_progress`; history e2e | 390 |
| 3 | 0034 and the nullable types cascade; leftJoins; `categoriaLabel`; booked create (date required); `vehiculoId` patch while booked; parity and booked e2e | 340 |
| 4 | Hold buttons and toasts; bulk exclusion; booked toggle and vehicle editing in `ServiceOrderForm`; reminder guard and its e2e; browser checks | 360 |

Before deploy: count workshop rows with `reminder.type='appointment' AND status='scheduled'` on non-booked orders. D10 will skip them.

## Open Questions

- [x] Pending appointment reminders on existing `open` orders will be skipped after deploy (D10). Resolved 2026-10-26: the dev DB (restore of the 2026-10-22 production backup) holds ZERO `appointment` reminders of any status, and skipping is the intended behavior once a car is in the shop. Re-run the pre-deploy count on the workshop DB anyway.
