# Proposal: Agenda Redesign

## Intent

The owner rejected the shipped `/agenda` as "simple and not friendly". Rebuild its UI to the approved mockup (`mockup/index.html`, the visual contract): hour grid, service-type colour, side detail, left column, tabs, slot-click booking.

## Scope

### In Scope
- 08:00–18:00 Panama hour grid (day/week), fixed 1 h blocks, now-line, today/weekend marks; month 3 cards + "+N más".
- Card: `HH:mm · tipo`, name, plate · make model (or "Sin vehículo"), technician initials, status pill. Colour = `categoria` (grey "Sin tipo").
- Detail popover (desktop) / bottom sheet (phone): day+time, vehicle, phone (`tel:`), description, type, technicians; Abrir orden, Reprogramar, No se presentó.
- Left column: mini calendar with busy dots, "Próxima cita", type filter with counts, week summary.
- Tabs Todas/Agendadas/Vencidas replace `VencidasPanel`; search "Buscar placa o cliente" over loaded items.
- Nueva cita: popover, prefilled from an empty slot; optional Vehículo and Tipo de servicio.
- Combined: day timeline + "En el taller ahora" (adds since-time, technicians).

### Out of Scope (follow-ups)
- Duration/capacity, drag-to-reschedule, polling, technician assignment at booking, server-side search, collapsed-rail shell change.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `workshop-agenda`: chip content (adds category, make/model, technicians; description only in detail), layout, Vencidas panel → tab, booking fields, actions move to the detail on every view, cancelled no-shows visible.

`service-orders` unchanged: POST already accepts `vehiculoId`/`categoria`/`tecnicoIds` for `booked` (`createOrder` `mayOmit`; CHECK `orden_vehiculo_categoria_required` allows nulls while booked).

## Approach

Read-side extension of `agenda/queries.ts` (vehicle make/model/year, `categoria`, `description`, aggregated technician names) → plain strings in `items.ts`. Views stay server-rendered CSS grid; one client shell owns selection, filters, search and popovers. Writes stay on existing routes. No migration, no new route, no dependency.

## Work Units (≤400 lines each, chained)

| WU | Content | Est. |
|----|---------|------|
| 1 | Query + item fields, e2e rows | ~300 |
| 2 | Card + hour grid (day/week) | ~380 |
| 3 | Detail popover/sheet, actions moved | ~350 |
| 4 | Left column + tabs + search | ~380 |
| 5 | Nueva cita: slot prefill, vehicle, type | ~300 |
| 6 | Month + combined + phone | ~350 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Technician aggregation is new SQL invisible to unit tests | High | e2e rows (injected-seam limit) |
| Hydration/RSC/portal traps in the client shell | Med | Plain props, digit-only time, LAN-IP browser check |
| "No se presentó" is not stored | High | Question 1 |
| Popover placement in 90 px columns | Med | Fixed side panel ≥ md |

## Rollback

Revert the tracker merge; read-only change, no data or schema to undo.

## Success Criteria

- [ ] Owner signs off at the LAN IP against all mockup frames, light and dark.
- [ ] Every mutation toasts; 44x44 on touch; no hydration/console errors.

## Proposal question round (owner review)

1. Mockup shows struck-through "No se presentó" cards and a count; today cancelled orders are hidden and no-show is not stored. Default: show `booked → cancelled` orders cancelled after `appointment_at` as "No se presentó", others stay hidden.
2. Detail type chips and "+ Asignar técnico": editable (PATCH `categoria`, POST `assignments`, both existing) or read-only? Default: editable; pencil = Abrir orden.
3. Search and type filter: visible range only? Default: yes.
4. "Próxima cita · en 20 min" freezes at render (no polling). Acceptable? Default: yes.
