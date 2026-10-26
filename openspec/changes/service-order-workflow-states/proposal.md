# Proposal: Service Order Workflow States

## Intent

Today an order is `open → in_progress → ready_for_review → done`. The workshop cannot record an appointment before the car arrives, cannot tell "diagnosing" from "repairing", and cannot say an order is stalled waiting for a part or the customer's approval. No status history exists, so the planned timer and live board (later changes) have nothing to read. SDD 1 of 4 from the 2026-10-25/26 grill.

## Scope

### In Scope
- States: "Agendada" (`booked`, new), "Recibida" (`open`, relabel only), "En diagnóstico" (`diagnosing`, new), "En progreso", "En espera" (`on_hold`, new, reason `repuesto` | `aprobacion_cliente`), "Lista para revisión", "Completada", "Cancelada".
- Transitions: booked → open; open → diagnosing (automatic only, on first technician); diagnosing → in_progress; in_progress ⇄ on_hold; in_progress → ready_for_review (readiness only); ready_for_review → in_progress | done; any non-terminal → cancelled.
- `orden_estado_historial`: one row per status change, every writer.
- `vehiculo_id` and `categoria` optional only while `booked` (one CHECK); write path to set them on a booked order.
- Fire-time guard: `appointment` reminder sends only while `booked`.
- Portal mapping, list/filter/bulk/metrics/print updates for the new values.

### Out of Scope (follow-up changes)
- Live board, customer view, "Pantalla" role.
- Agenda views, "Vencida", Reprogramar, quick customer create.
- Technician hours; suppliers/purchase orders.

## Decisions

| Rule | Source |
|---|---|
| diagnosing → in_progress: jefe_taller/administrador only. **Removes the técnico's `open → in_progress` exception (`transitions.ts:67-69`) — intended behavior change** | owner |
| No open → in_progress; flow always passes diagnóstico | owner |
| on_hold in/out: jefe/admin only (`service-orders.assign`) | owner |
| Cancel legal from every non-terminal state, today's permission | default, owner may override |
| Técnico edits findings/work lines in diagnosing and in_progress; on_hold blocks parte lista and work-line writes; booked editable by order creators | default, owner may override |
| No history backfill; consumers tolerate zero rows | default, owner may override |
| Booked excluded from portal snapshot; diagnosing/on_hold → "En proceso"; no portal deploy | default, owner may override |

## Capabilities

### New Capabilities
- `service-order-status-history`: history table, writers, tolerance of missing history.

### Modified Capabilities
- `service-orders`: Status Lifecycle (R21), Creation (R20, booked relaxes vehicle/category), Editing gate, Bulk Status, Order Assignment (auto-diagnosing), list columns/joins, print, appointment reminder guard.
- `order-work-lines`: writes and parte lista refused while `on_hold`.
- `portal-sync`: status mapping and booked exclusion.
- `metrics-dashboard`: backlog counters include new states.
- `table-bulk-actions`: status badges for new values.

## Approach

Explore recommendations: relabel `open`, no rename; one service `setStatus(tx, …)` helper used by `createOrder`, `transitionOrder`, `applyReadiness`, `assignTecnico`; nullable `espera_motivo` with CHECK tied to `on_hold`; CHECKs use `status::text` (single-transaction migrations, hand-edited 0033). Four chained PRs (~350/400/350/280 lines) behind a tracker branch.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration enum + CHECK in one transaction fails | Med | Spike on throwaway DB first |
| Writer bypasses history | Med | Single helper; e2e per path |
| innerJoin → leftJoin breaks count parity | Med | Change list + count together; e2e |
| Portal rejects whole ingest | Low | Map + exclude booked; parse test |

## Rollback Plan

Revert the chain. Enum values cannot be dropped in PG; they stay unused. History table and `espera_motivo` drop via migration once no row is `booked`/`diagnosing`/`on_hold`.

## Success Criteria

- [ ] Every status change writes exactly one history row (e2e per writer).
- [ ] Illegal transitions and técnico diagnosing → in_progress refused.
- [ ] Booked order without vehicle saves; leaving booked without one is refused by DB.
- [ ] Portal ingest accepts every snapshot; appointment reminder skipped once received.
