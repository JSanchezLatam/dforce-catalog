# Design: Workshop Agenda

## Technical Approach

`/agenda` is a server component under the `(app)` shell that reads orders by a date range and draws a hand-rolled CSS grid. Every date is computed and formatted on the server; client islands (dialogs, actions) get plain strings only. All writes reuse `POST /api/service-orders`, `PATCH /api/service-orders/[id]` and `POST /api/customers` unchanged. New code lives in `src/modules/agenda/`.

## Architecture Decisions

| # | Decision | Rejected | Rationale / evidence |
|---|---|---|---|
| D1 | `agenda.manage` in `ACTIONS`; MATRIX literal: `tecnico: false`, `jefe_taller: true`, `pantalla: false`, `administrador: true`. | Reusing `service-orders.create` | Nav filters on one positive action (`policy.ts:30-32`). MATRIX is exhaustive, so a missing cell is a tsc error (`policy.ts:45-47,120-121`). |
| D2 | `ROUTE_GUARDS["/agenda"] = { GET: "agenda.manage" }`. The page ships in WU1 as a stub that contains a literal `can(user, "agenda.manage")` and renders `PermissionDenied`. | Adding the action first and the page later | The reachability test fails for any action without a route (`route-guards.test.ts:210-230`). Completeness needs a page↔entry match (`:196-208`). `(app)` is stripped from the URL (`:154`). The page sits in `src/app/(app)/agenda/`, not `src/app/agenda/` (the proposal's path), because it needs the sidebar. `/tablero` is outside the shell on purpose. |
| D3 | Nav: `{href:"/agenda", label:"Agenda", icon:"agenda", action:"agenda.manage"}` in `CRM_ITEMS` after "Órdenes de servicio". `NavIconKey` gets `"agenda"`, and the sidebar map gets `agenda: CalendarDays`. | Reusing `vencimientos` (CalendarClock) | Same glyph on two entries is what `nav-items.ts:45-48` refuses (`nav-items.ts:4,17-26`; `app-sidebar.tsx:4,63`). |
| D4 | `agenda/dates.ts` is pure, has no imports, and is client-safe. Day keys are strings; calendar math uses `Date.UTC` on the key's parts, and a round-trip check rejects `2026-02-30`. `panamaMidnight(key) = new Date(\`${key}T00:00:00-05:00\`)`. Exports: `addDays`, `weekStart` (Monday, `(getUTCDay()+6)%7`), `monthGrid` (variable 4–6 rows, Monday on or before day 1 through Sunday on or after the last day), `rangeFor(view, key) → {from,to}` (half-open), `parseAgendaParams` (an unknown `view` falls back to `week`, a bad `date` to today), `OVERDUE_MARGIN_MS = 3_600_000`, `isOverdue(status, at, now)`, and `formatAgendaTime(iso) → "HH:mm"` built with `formatToParts` and `h23`. | SQL `AT TIME ZONE` (board style); importing `formatBoardTime` | The zone is hardcoded and Panama has no DST (`datetime.ts:16-21,41`; `board.e2e.test.ts:20`). Bound `timestamptz` parameters make the session time zone irrelevant. `board/format.ts` is import-free, but it returns `dd/MM HH:mm` and its test pins that output, so the agenda copies the 4-line pattern (`format.ts:9-26`) instead of coupling modules. `toWorkshopDateKey` (`datetime.ts:64`) gives today's key. |
| D5 | `agenda/queries.ts` takes a required `OrderScope`, and the page passes `orderScope(user)`. Three queries, each `limit(cap+1)` so that more than `cap` rows means truncated: **range** (`appointment_at >= from AND < to AND status <> 'cancelled'`, ordered by `appointment_at, id`, cap 500); **overdue** (`status='booked' AND appointment_at < now − margin`, ordered ascending, cap 200); **inWorkshop** (`status IN BACKLOG_STATUSES minus booked`, ordered by `created_at`, cap 200). All three inner-join `cliente` (name, phone) and left-join `vehiculo` (plate, make, model). `cap` is a parameter with a default, so e2e can prove it. | `SYSTEM_SCOPE`; reusing `board/queries.ts` | Both granted roles hold `readAll`, so `orderScope` resolves to `SYSTEM` today (`scope.ts:26-27`). It still fails closed if the matrix ever grants the agenda to a role without `readAll`. Join shape from `service-orders/queries.ts:172-174`. The board file must never name `cliente` (`queries.privacy.test.ts:8-12`). Status list from `metrics/shape.ts:7`. No `count(*)`: pg returns it as a string. |
| D6 | No technician names on in-workshop rows in v1. | A batched active-only query like the board's (`board/queries.ts:47-54`) | The owner asked for orders in the workshop, not per-technician data. It saves a query and an e2e. Follow-up. |
| D7 | `agenda/items.ts` (`toAgendaItem(row, now)`) maps a row to plain data: `{id, href, dayKey, time, customerName, customerPhone, vehicleLabel, description, status, statusLabel, muted: status!=="booked", overdue}`. The page captures `const now = new Date()` once, the vencimientos pattern (`vencimientos/page.tsx:75-77`). | Passing `Date` to the client | A `"use client"` first paint is server-rendered (`datetime.ts:30-38`). |
| D8 | Server views: `AgendaHeader` (view links, prev/next/Hoy links, `RefreshListButton`, booking trigger), `DayView`, `WeekView` (7 columns at `md:` and up, a vertical list grouped by day below), `MonthView` (3 chips, then a "+N más" link to `?view=day&date=`, with outside-month days muted), `CombinedView` (the day's appointments plus the in-workshop list, `lg:grid-cols-2`, stacked below), and `VencidasPanel` on every view. Chips are `Link`s with `min-h-11`, the badge uses `statusBadgeClassName` and `ORDER_STATUS_LABEL`, and the hold reason uses `ESPERA_MOTIVO_LABEL`. Truncation shows a notice. | A calendar library | No dependency and no hydration surface (`statuses.ts:17-32`; `RefreshListButton.tsx:29`). |
| D9 | `AgendaBookingForm` is a client component with a controlled Dialog. Fields: `CustomerPicker`, `<input type="date">` (prefilled from the clicked day), `<input type="time">`, and Descripción. It POSTs `{clienteId, status:"booked", appointmentAt:\`${day}T${time}:00-05:00\`, description}`. The vehicle and category stay omitted. | Props on `ServiceOrderForm` | Booked orders may omit the vehicle and category (`service.ts:188-194,221-231`). The route parses the string (`route.ts:73-80`) and maps 400 `errors` and 409 `cliente_deactivated` (`:111-127`). Date and time inputs hold strings, so the browser's zone never enters (`ServiceOrderForm.tsx:60-66` is the trap). |
| D10 | `CustomerPicker` gets an optional `renderCreate?: (select: (c: ClienteListItem) => void) => ReactNode` that replaces the `CustomerForm` branch when it is given. | A boolean flag that imports agenda code into service-orders | The picker is shared, and an omitted prop keeps today's behavior (`CustomerPicker.tsx:44-59,248-261`). |
| D11 | `CustomerQuickForm` takes name and phone and POSTs `/api/customers`. It copies `CustomerForm`'s submit: `stopPropagation`, 400 field errors, branching the 409 on `body.error`, "Guardar igual" with `allowDuplicatePhone:true`, the catch, and the close and callback after the try. It adds "Usar ese cliente": `GET /api/customers?search=<phone>&pageSize=50`, then picks `id === existingClienteId`. If no active match comes back, it shows only "Ver el cliente existente". | Reusing the full `CustomerForm` | `CustomerForm.tsx:398-496,546-589`; `customers/route.ts:41-57,106-115`. The default `status=active` hides a deactivated match, which cannot be booked anyway (`service.ts:213`). |
| D12 | `ReprogramDialog` sends PATCH `{appointmentAt}`, prefilled with the item's `dayKey`/`time`. `NoShowConfirm` sends PATCH `{status:"cancelled"}`. Errors are inline: `errors.form`, then `errors.appointmentAt`, then `message`, then a generic line (`[id]/route.ts:153-196`). Toasts: "Cita agendada", "Cita reprogramada", "Orden cancelada", "Cliente creado". Each toast goes above `router.refresh()`, and both sit below the try/catch (`OrderStatusControls.tsx:72-107`). | — | Status edges `booked→cancelled` (`transitions.ts:30`); editing `booked` is limited to admin and jefe (`edit-policy.ts:38-41`). |

## Data Flow

    page.tsx ─ requireSession → can(agenda.manage) → parseAgendaParams → now
      ├─ range/overdue/inWorkshop(scope, …)  (Promise.all)
      └─ toAgendaItem(row, now) → server views → client islands (strings only)
    island ─ fetch API → toast → router.refresh()

## File Changes

| File | Action |
|---|---|
| `src/modules/auth/policy.ts`, `route-guards.test.ts` | Modify (D1–D2) |
| `src/modules/layout/nav-items.ts`, `src/components/app-sidebar.tsx` | Modify (D3) |
| `src/app/(app)/agenda/page.tsx` (+ `page.test.tsx`) | Create |
| `src/modules/agenda/{dates,queries,items}.ts` + tests | Create |
| `src/modules/agenda/{AgendaHeader,DayView,WeekView,MonthView,CombinedView,VencidasPanel,AgendaBookingForm,CustomerQuickForm,ReprogramDialog,NoShowConfirm}.tsx` + tests | Create |
| `src/modules/service-orders/CustomerPicker.tsx` | Modify (D10) |
| `src/e2e/agenda.e2e.test.ts` | Create |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | `dates.ts`: leap year and year rollover, a Sunday → the previous Monday, February 2027 gives 4 rows and a 6-row month gives 6, `panamaMidnight("2031-03-10")` = `05:00Z`, invalid params fall back, `isOverdue` at exactly 60 min is false. `items.ts`: muted and overdue flags. | Pure. Mutation-verify each one. |
| e2e | Range: `04:59:59Z` lands on the previous day, `05:00:00Z` is in, the next day's `05:00Z` is out, cancelled is excluded, a received order is included. Overdue: `now−60min` is out, `now−60min−1ms` is in, a past non-booked order is out. inWorkshop: booked, done and cancelled are out, a no-vehicle order is in. Cap: `cap=2` with 3 seeded rows returns 3. Customer name present. | 2031 window, filtered to seeded ids (`board.e2e.test.ts:1-59`). The bounds are parameters, so session time zone has no effect. |
| jsdom | Views render items, "+N más", phone list. Dialogs: exact payload (incl. `-05:00`), 400/403/409 inline errors, the 409 duplicate flow, nested submit not firing the outer form, toast order. | `fetch` stubs return `new Response(JSON.stringify(body), {status})`. Spanish assertions. |
| Browser | Hydration and 44 px on tablet and phone, via the LAN IP. | Manual (AGENTS.md limits 2 and 3). |

## Work Units (chain off tracker `feat/workshop-agenda`)

| WU | Files owned | Est. |
|---|---|---|
| 1 | policy, route-guards, nav-items, app-sidebar, page stub, `dates.ts` | ~300 |
| 2 | `queries.ts` (range, overdue) + e2e | ~280 |
| 3a | `items.ts`, `AgendaHeader`, `DayView`, `WeekView`, page wiring | ~380 **risk** |
| 3b | `MonthView` | ~200 |
| 4 | inWorkshop query + e2e, `CombinedView`, `VencidasPanel` (read-only) | ~330 |
| 5 | `AgendaBookingForm`, day "+" prefill | ~350 |
| 6 | `CustomerQuickForm`, `CustomerPicker` prop | ~380 **risk** |
| 7 | `ReprogramDialog`, `NoShowConfirm` | ~260 |

## Threat Matrix

N/A. The change has no shell, subprocess, VCS automation or process boundary. The one new route is covered by D2 and its existing tests.

## Migration / Rollout

No migration required. Rollback means reverting the tracker merge.

## Open Questions

- [ ] Default view when `view` is absent: the design says `week`, and the spec must agree.
- [x] A "No se presentó" sent from a stale screen would cancel an order received in the meantime (`open→cancelled` is legal, `transitions.ts:31`). Owner-side decision 2026-10-26: IN scope, because cancelling is terminal. `PATCH /api/service-orders/[id]` accepts an optional `expectedStatus`; `transitionOrder` compares it with the status read under `lockOrderForMutation` and throws a new `StaleOrderStatusError` → 409 "La orden cambió mientras la mirabas. Actualizá la agenda.". Absent → unchanged behaviour. Needs an e2e (real lock path).
