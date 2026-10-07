# Proposal: Metrics Dashboard

## Intent

The workshop's client asked for a dashboard of main metrics. Most requested: technician productivity; also "requests attended per month". Today nothing aggregates this — the data exists (`orden_servicio`, `orden_tecnico`, `orden_linea_trabajo`) but only as per-order screens.

## Scope

### In Scope (v1)
1. **Technician productivity** (headline): per technician per month, orders CLOSED (`status = done`, bucketed by `completed_at`) AND hours logged (`SUM(duracion_minutos)` by `tecnico_id`, bucketed by `fecha`). Always shown together, never one alone.
2. **Orders received per month** (`created_at`).
3. **Orders closed per month** (`status = done`, `completed_at`).
4. **Open backlog by status** — current snapshot of `open` / `in_progress` / `ready_for_review`.
5. **"Mis números"** for `tecnico`: metric 1 restricted to their own row.

### Out of Scope (follow-ups)
- Average time to close (`created_at → completed_at`), orders by `categoria`, vencimientos contacted per month (`vehiculo_contacto`), cancellation rate, reminders sent.
- Prices/revenue (no prices until v2). CSV/PDF export. Custom date ranges.

## Capabilities

### New Capabilities
- `metrics-dashboard`: workshop metrics, technician productivity, role-scoped "Mis números".

### Modified Capabilities
- None (`user-management` RBAC gains one action; behavior of existing grants unchanged).

## Approach

- **Business rules**: a closed order credits EVERY assigned technician (1 each; assignments are never removed), so the per-technician column sum exceeds total closed orders — the table states it: "Una orden con varios técnicos cuenta para cada uno". `done` is terminal (`transitions.ts`), so counts are stable. Cancelled orders count nowhere except "received".
- **Months** in America/Panama: `date_trunc('month', completed_at AT TIME ZONE 'America/Panama')`; `fecha` is already a local date. Current month from `toWorkshopDateKey`.
- **Access**: new `metrics.read` action (administrador + jefe_taller). Técnico gets `/mis-numeros` only; `tecnicoId` resolved server-side via `findTecnicoByUserId(session.user.id)`, NEVER from URL/query. A técnico without a roster link sees an empty state, not an error. e2e row pins the `WHERE`.
- **UI**: month table per technician (default current month) + trend for the last 6 months. Charts from Arc (`@uiarc/*` shadcn registry, adds `motion`): single-series bar charts — one per series (orders closed/month, received/month, hours per technician). No grouped/stacked/tooltip charts, so exact numbers live in the table. Design direction via the impeccable skill at implementation. 390/768 layouts; nothing secure-context-only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/metrics/` | New | Aggregation queries (SQL-heavy) |
| `src/app/(app)/metrics/`, `mis-numeros/` | New | Pages |
| `src/modules/auth/policy.ts` | Modified | `metrics.read` |
| `src/components/ui/` + `package.json` | New | Arc charts, `motion` |
| nav/sidebar | Modified | Entry per role |
| `src/e2e/` | New | Real-SQL rows for aggregates and técnico scope |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Aggregates wrong at runtime (injected-seam limit) | High | e2e per query, incl. month boundary at 00:00 Panama |
| Técnico sees others' numbers | Med | Session-only id + e2e of the WHERE |
| Arc component set/API differs from assumption (not re-verified in this phase) | Med | Verify at design; fallback: plain table only |
| "Productivity" read as ranking/blame | Med | Label the double-count rule; open question below |

## Rollback Plan

Revert the chained PRs (new module/pages only); remove `metrics.read` and `motion`. No migration, no data written.

## Dependencies

- `technicians-and-work-lines` (merged). Index `orden_linea_tecnico_fecha_idx` already exists.

## Delivery Estimate

Chained PRs ≤400 lines: WU1 queries + e2e · WU2 policy + dashboard page/table · WU3 Arc charts + `motion` · WU4 "Mis números".

## Open Questions

- Did the productivity definition (closed orders + hours) come from the client? Owner to confirm — not a blocker.
- Trend window: 6 months assumed.

## Success Criteria

- [ ] Admin/jefe_taller see v1 metrics 1–4 for any month; técnico sees only their own.
- [ ] e2e proves month bucketing and técnico isolation against real Postgres.
- [ ] Usable at 390 and 768 via the LAN IP.
