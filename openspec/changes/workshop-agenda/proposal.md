# Proposal: Workshop Agenda

## Intent

Appointments live on a physical board. Booked orders already exist in the app (`booked` + `appointment_at`) but nothing shows them by date, so the board stays the source of truth. One `/agenda` for the whole workshop replaces it.

## Scope

### In Scope
- Action `agenda.manage`: `administrador`, `jefe_taller` allow; `tecnico`, `pantalla` deny. Route guard, nav entry.
- `/agenda?view=day|week|month|combined&date=YYYY-MM-DD`: server-rendered CSS grid, week starts Monday, chips by start time, overlaps stack, month cells 3 chips + "+N más".
- A booked order IS the appointment. Non-booked, non-cancelled orders with `appointment_at` show muted with a status badge; cancelled hidden.
- Combined view: the selected day's appointments beside the live in-workshop orders (`open`, `diagnosing`, `in_progress`, `on_hold`, `ready_for_review`); stacked on phone.
- Vencida: `booked` and `appointment_at < now − 60 min`, server-computed. Actions Reprogramar (`PATCH appointmentAt`) and "No se presentó" (plain cancellation, no reason, no counter). Unbounded "Vencidas (N)" panel on every view.
- Slim booking dialog (customer, date + time, description) with quick customer create (name + phone, `POST /api/customers`, 409 `duplicate_phone` flow).
- Agenda rows MAY carry customer name and phone: staff-only surface. This is deliberate and does not relax the board's whitelist.
- Toasts on every mutation; 44px targets; tablet and phone.

### Out of Scope
- Duration, capacity, technician columns, calendar library, new write API, new index, polling.
- Reminders for bookings < 24 h ahead get none today (`reminders/schedule.ts:79,89-91`) — owner awareness, follow-up.

## Capabilities

### New Capabilities
- `workshop-agenda`: access, views, muted/hidden rules, Vencida and its actions, combined view, booking and quick customer create.

### Modified Capabilities
- None. Writes reuse the existing order and customer APIs unchanged; `jefe_taller` already inherits new admin actions per the `technicians` spec.

## Approach

- New module `src/modules/agenda/`: pure date helpers (Panama day key, ranges, `isOverdue`), a range query and an overdue query joining `cliente`/left-joining `vehiculo`, capped.
- **In-workshop side: new query in `agenda/`, not `src/modules/board/queries.ts`.** That file is forbidden to join `cliente` and a text test enforces it; the agenda needs name and phone. Reuse the status constants and `ORDER_STATUS_LABEL`, not the board's row shape.
- Date input: day key + `HH:mm` sent with `-05:00`; client date text digit-only (`board/format.ts` pattern) to avoid the hydration trap.
- Delivery: feature-branch chain, tracker `feat/workshop-agenda`, ≤400 lines per PR (7 WUs per explore).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/auth/policy.ts`, `route-guards.test.ts` | Modified | `agenda.manage` |
| `src/modules/layout/nav-items.ts`, `src/components/app-sidebar.tsx` | Modified | Nav entry |
| `src/modules/agenda/` | New | Helpers, queries, views, dialogs |
| `src/app/agenda/page.tsx` | New | Page |
| `src/modules/service-orders/CustomerPicker.tsx` | Modified | Quick-create hook, backward compatible |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Panama-midnight range SQL wrong | Med | e2e rows for boundaries |
| Hydration mismatch from locale formatting | Med | Digit-only formatting; browser check |
| Reminder gap < 24 h | High | Documented follow-up |

## Rollback Plan

Revert the tracker merge; no migration, no data change.

## Success Criteria

- [ ] Admin/jefe book, reprogram and mark no-show from `/agenda` at the LAN IP on tablet and phone; tecnico/pantalla get `PermissionDenied`.
- [ ] An appointment 61 min past shows in "Vencidas" regardless of the viewed range.
- [ ] Board payload still carries no customer data.

## Proposal question round

Skipped: the owner grill (explore.md, "Owner answer") resolved every product question; decisions above are final.
