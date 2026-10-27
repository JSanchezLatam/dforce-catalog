# Exploration: workshop-agenda

Date: 2026-10-26. Owner decisions from the grill are final: one agenda for the whole workshop that replaces the physical board, with no columns per technician; day, week, month and combined views; "Vencida" is computed, with two actions, Reprogramar and "No se presentó" (an ordinary cancellation, never counted); quick customer create with name and phone through `createCliente`; a booked order IS the appointment.

## Summary

`/agenda` is a server-rendered page that reads orders by visible date range and draws the views as a hand-rolled CSS grid, with no calendar library. Booking, reprogramming and cancelling already exist in the order API with the right permission checks, so the change adds a read query, pure date helpers, one policy action and three small client dialogs.

## Current state

### Create, edit and permissions

- `jefe_taller` and `administrador` hold `service-orders.create`, `.write` and `.assign` (`src/modules/auth/policy.ts:96-102,162-179`). `tecnico` lacks `create`/`assign`; `pantalla` holds nothing.
- Editing `appointmentAt` goes through `updateOrder`, gated by `canEditOrderFields`; `booked` is editable by admin and jefe only (`service-orders/edit-policy.ts:38-40`). Cancelling needs `service-orders.assign` (`transitions.ts:75-77`); `booked` → `open | cancelled` (`:30`).
- `PATCH /api/service-orders/[id]` takes `{status}` (`route.ts:61-70`) or `{appointmentAt}` (`:90-104`); 409/403 messages are Spanish (`:165-179`).
- `ServiceOrderForm` has the Recibida/Agendada radio (`ServiceOrderForm.tsx:445-471`) but owns its `DialogTrigger` (`:418`), has no default status/date props, carries reception, category and technician sections, and is ~770 lines — not reusable as is.
- Booked create: date required (`service.ts:192-194`), vehicle/category optional (`:221-231`), `booked` history row (`:260`).

### Display and time zone

- Every current `appointmentAt` display is a server component using `formatDateTime` (`toLocaleString("es-PA", { timeZone: "America/Panama" })`, `src/shared/datetime.ts:46-49`). In a client component that breaks hydration (Node NBSP vs Chromium space); `src/modules/board/format.ts:9-26` is the digit-only `formatToParts` pattern.
- `toWorkshopDateKey` (`datetime.ts:64-66`) gives the Panama `YYYY-MM-DD`; `board/queries.ts:19` shows the Panama day-start SQL.
- The order form builds `datetime-local` with browser-local getters (`ServiceOrderForm.tsx:60-66`), correct only on a device set to Panama time. The agenda composes day key + `HH:mm` and sends an ISO string with `-05:00` (Panama has no DST).

### Reminders

- Created after commit when `appointmentAt` is set (`service.ts:276-278`); a date change cancels pending `appointment` reminders and plans a new one (`:362-364,385,394-396`).
- Fires at `appointmentAt − 24h` (`reminders/schedule.ts:10,89-91`) and any plan already in the past is dropped (`:79`): **a booking made less than 24 h ahead gets no reminder at all.** Existing behaviour, not in scope; the owner should know.
- Fire-time guard skips non-booked or past orders (`reminders/job.ts:242-249`). "No se presentó" = `cancelled`, which cancels every pending reminder (`service.ts:494-497`) and writes a `booked → cancelled` history row; no reason, no counter.

### Duration, overlap, indexes

- Only `appointment_at` exists (`schema.ts:557`); no duration, capacity or overlap concept. Overlap is allowed by construction.
- `orden_servicio` indexes: `(cliente_id, created_at)`, `(status)`, `(vehiculo_id, created_at)` (`schema.ts:586-590`); nothing on `appointment_at`. The list query inner-joins `cliente` and left-joins `vehiculo` (`queries.ts:156-179`); reads need an `OrderScope` (`scope.ts:26`). The portal withholds `booked` (`portal-sync/snapshot.ts:68-73`).

### UI and routing

- No calendar or date library in `package.json`; none in `src/components/ui/`. `CalendarDays` from lucide is already used.
- `NavIconKey`/`CRM_ITEMS` (`layout/nav-items.ts:4,17-26`), icon map (`components/app-sidebar.tsx:62-63`). `MATRIX` is exhaustive (`policy.ts:47,122`). `route-guards.test.ts` requires registration, reachability of each Action, a literal `can(user, "x")` in the page, and matching methods.

### Quick customer create

- `POST /api/customers` (`customers.write`): 201 `{cliente}`, 400 `{errors}`, 409 `{error:"duplicate_phone", existingClienteId}` (`app/api/customers/route.ts:92,106-115`). Name + phone (7–15 digits) required (`customers/validation.ts:91-100`); `allowDuplicatePhone` bypasses the check and is never persisted (`customers/service.ts:71-73,128-135`); opt-outs default false.
- `CustomerForm` implements the 409 UI (`CustomerForm.tsx:436-466,546-589`) and its submit calls `event.stopPropagation()` (`:407`), load-bearing for a nested dialog. `CustomerPicker` offers "Crear cliente nuevo" with the full form (`CustomerPicker.tsx:248-261`). `VehicleQuickForm` is the slim-form precedent. The 409 returns only an id; "use the existing customer" needs `GET /api/customers?search=<phone>`.
- Order create needs an active `clienteId` (`service.ts:196-215`).

## Options

| Topic | Options | Recommendation |
|---|---|---|
| Rendering | hand-rolled CSS grid in a server component vs a calendar library | grid: no dependency, no hydration surface, Panama time under control |
| Duration | none (chips by start time, stacked) / fixed display slot / duration column | none |
| Combined view | month grid + selected day list / week + day list / day + week side by side | month + day list (phone: month on top, list below) |
| Booking form | new slim `AgendaBookingForm` vs props on `ServiceOrderForm` | slim form, reusing `CustomerPicker` |

## Recommendation

1. One action `agenda.manage` for administrador and jefe_taller (the jefe already does every agenda operation); `tecnico` and `pantalla` false.
2. `/agenda?view=day|week|month|combined&date=YYYY-MM-DD`, server component, navigation by links, client islands only for dialogs and actions; week starts Monday.
3. Range query on `appointment_at` between Panama midnights, joining `cliente` and left-joining `vehiculo`, capped (e.g. 500 rows). Non-cancelled orders: `booked` actionable, received-or-later muted with a status badge. Month cells: 3 chips + "+N más".
4. Vencida: server-computed (`booked` and `appointment_at < now − 60 min`, exported constant), passed as a boolean prop; plus an unbounded "Vencidas (N)" panel so an old overdue appointment never disappears.
5. Overlap allowed, chips stack.
6. `CustomerQuickForm` (name + phone) with the copied 409 flow ("Ver el cliente existente", "Guardar igual", "Usar ese cliente"), `stopPropagation`, no opt-out fields.
7. Toasts per AGENTS.md: "Cita agendada", "Cita reprogramada", "Orden cancelada", "Cliente creado".
8. 44 px targets on chips and day cells.
9. No index in v1 (small volume; revisit if slow).
10. Manual refresh via `RefreshListButton`; polling is a follow-up.

## Work units (chained PRs, ≤400 lines each; ~1,500–1,800 total)

| WU | Content | Est. |
|---|---|---|
| 1 | `agenda.manage`, route guard, nav link, pure date helpers, `isOverdue` | ~300 |
| 2 | Range + overdue queries with e2e (Panama midnight, margin boundary) | ~250 |
| 3 | `/agenda` day, week, month views, prev/next/Hoy, phone fallback | ~380 |
| 4 | Combined view and "Vencidas" panel | ~250 |
| 5 | `AgendaBookingForm` dialog, click-a-day prefill | ~350 |
| 6 | `CustomerQuickForm` with the 409 flow | ~350 |
| 7 | Reprogramar and "No se presentó" with 409 handling and toasts | ~250 |

## Risks

- Reminder gap for bookings within 24 h (existing).
- Browser-local `datetime-local` (avoided with explicit `-05:00`).
- Client-side locale formatting breaks hydration.
- Range SQL needs e2e; a green unit suite proves nothing.
- `CustomerPicker` is shared with `ServiceOrderForm`: keep its props backward compatible.

## Open questions for the owner

1. What "vista combinada" means (recommend month grid + selected day list).
2. Whether received orders show on the agenda (recommend yes, muted) and the 60-minute Vencida margin.
3. Whether jefe_taller manages the agenda (recommend yes).

## Owner answer (2026-10-26)

"Vista combinada" = the agenda with its appointment details shown together with the service orders currently in progress in the workshop (not month + day list). Defaults accepted: administrador and jefe_taller manage the agenda; received orders show muted; Vencida after 60 minutes.
