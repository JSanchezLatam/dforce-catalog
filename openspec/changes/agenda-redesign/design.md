# Design: Agenda Redesign

## Technical Approach

Read-side extension plus a UI rebuild against `mockup/index.html`. `page.tsx` stays the only server entry: it reads, maps rows to plain items, and hands them to one client shell. No migration, route or dependency.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Technicians | A second batched query `inArray(ordenTecnico.ordenId, ids)` joined to `tecnico` (deactivated excluded), grouped in TS | Correlated `json_agg` subselect; one query per order | It copies `board/queries.ts:47-59`, and drizzle types the result. No N+1 |
| No-show rows | `agendaRange` WHERE becomes `status <> 'cancelled' OR EXISTS (orden_estado_historial h WHERE h.orden_id = o.id AND h.from_status='booked' AND h.to_status='cancelled' AND h.changed_at > o.appointment_at)` | A new column; `updated_at > appointment_at` | `setStatus` writes every transition to history. `updated_at` moves on any edit. Item invariant: `status==='cancelled'` ⇒ `noShow` |
| Shell split | `AgendaShell` (client) owns tab, search, type filter, selection and booking, and renders the views with the filtered items. Views are plain components with no `"use client"` and no server imports | Server views with client leaf cards | Counts, "+N más" and lanes must reflect the filter. A self-hiding card cannot do that. This departs from the proposal ("views stay server-rendered"), on purpose |
| Detail | ≥md: one controlled Base UI `Popover` with `Positioner anchor={cardEl}`, non-modal, in a new `src/components/ui/popover.tsx` wrapper. <md: `Sheet side="bottom"`, `showCloseButton={false}` (its stock button is 32px with "Close"), and our own 44px "Cerrar". Chosen by `matchMedia("(min-width: 768px)")` inside the click handler | Side Sheet everywhere | It matches frame 1 (no backdrop). Base UI is installed. Both portal only while open, so the SSR markup holds no portal (this is not the `typeof document` trap) |
| Nueva cita | One `Dialog` owned by the shell, opened by `openBooking(day, time?)` from the header button, the phone FAB and empty-slot buttons. Fields gain Vehículo (optional) and Tipo (optional chips) | Anchored popover; one Dialog per slot | `BookingFields`, the `CustomerPicker` and the quick-form portal already work in a Dialog. Frame 5 is a free-standing card |
| Vehicles | `GET /api/customers/[id]/vehicles` after the customer is selected. Failed ≠ empty, as in `ServiceOrderForm.tsx:187-211` (copied, not extracted) | Extracting a hook from ServiceOrderForm | It keeps ServiceOrderForm out of scope. The extraction becomes a follow-up |
| Detail edits | Booked only. Type chips → `patchOrder(id,{categoria, expectedStatus:"booked"})`, toast "Tipo de servicio actualizado". Assign → reuse `AssignTecnicoControl`, with `available` = the roster from `listTecnicos()` (only when `can(user,"service-orders.assign")`) minus the item's technicians | — | Both write paths exist. The PATCH cannot unset (`isServiceCategory` rejects null) |
| Colour | `globals.css` `@layer components`: `.agenda-ev`, `.agenda-ev-strip` and `.agenda-dot`, with hue set by `[data-categoria=instalacion\|mant_preventivo\|mant_correctivo\|reparacion\|revisado\|none]` (262/205/35/350/152/240 at saturation 6%), plus a `.dark .agenda-ev` variant. The formula is copied from mockup lines 47-56 | New `:root` tokens; reusing `--chart-*` | This is the approved formula. Hue-only, so it is theme-agnostic. `--chart-*` hues do not match the mockup |
| Labels | `CATEGORIA_LABEL` for the five types. "Sin categoría" for null (agenda only) | Mockup casing | One vocabulary repo-wide |

## Data Flow

    page.tsx ── agendaRange / agendaOverdue / agendaInWorkshop / agendaBusyDays / agendaNext ── listTecnicos
       └─ toAgendaItem(row, now) ─→ AgendaShell(items, overdue, workshop, roster, busyDays, next, nowMinute, today)
             ├─ filterItems(tab, search, types) ─→ DayGrid / WeekGrid / MonthView / CombinedView
             ├─ DetailPopover | DetailSheet ─→ ReprogramDialog, NoShowConfirm, patchOrder, AssignTecnicoControl
             └─ BookingDialog ─→ POST /api/service-orders ─→ toast ─→ router.refresh()

## Interfaces

```ts
// items.ts. No Date and no function crosses the boundary; numbers and arrays of plain objects are serialisable.
type AgendaItem = { id; href; dayKey; time /* HH:mm */; minuteOfDay: number; customerName; customerPhone;
  vehicleLabel /* "AB 1234 · Toyota Hilux" | "Sin vehículo" */; vehicleDetail /* + year */;
  categoria: ServiceCategory | null; categoriaLabel; description: string | null;
  technicians: { id: string; nombre: string; initials: string }[];
  status; statusLabel; muted; overdue; noShow: boolean };
```

Pure helpers in `items.ts`: `matchesSearch` (NFD fold, plate/name), `filterItems`, `typeCounts`, `weekSummary` (Agendadas/Recibidas/Vencidas/No se presentó), `layoutDay(items) → {item, lane, lanes}` (greedy 1 h intervals). `grid.ts`: `ROW=104`, `hourWindow(items) = [min(8, firstHour), max(18, lastHour+1)]` so out-of-hours rows never vanish, `top = (minuteOfDay − start·60)/60·ROW`. The now-line shows only when `today` is visible and inside the window. Week caps at 2 lanes, and anything beyond is a 44px "+N" link to the day view.

Time: everything is formatted on the server. Times use the existing `formatAgendaTime` (numeric `formatToParts`). The "en N min" for the next appointment and the since-time use `board/format.ts#formatAge`, frozen at render.

## File Changes (by WU, chained, ≤400 changed lines each)

| WU | Files |
|---|---|
| 1 Query + items | M `agenda/queries.ts` (columns make/model/year/categoria/description, technicians batch, no-show EXISTS, `agendaBusyDays`, `agendaNext`, since batch for workshop), M `items.ts`, `items.test.ts`, `items.fixture.ts`, `queries.test.ts`, M `src/e2e/agenda-queries.e2e.test.ts`, `agenda-combined.e2e.test.ts` |
| 2 Card + grid | C `AgendaCard.tsx`, `grid.ts`(+test), `DayGrid.tsx`, `WeekGrid.tsx`; M `globals.css`; D `AgendaChip*`, `DayView*`, `WeekView*` |
| 3 Detail | C `ui/popover.tsx`, `AgendaShell.tsx` (selection only), `AgendaDetail.tsx`(+test); M `page.tsx`; D `ItemActions*` |
| 4 Left column + tabs | C `AgendaSidebar.tsx` (mini-cal, next, type filter, summary), `AgendaTabs.tsx`; M `AgendaShell.tsx`, `AgendaHeader.tsx` (search, mockup layout); D `VencidasPanel*` |
| 5 Nueva cita | M `AgendaBookingForm.tsx` (controlled, `initialTime`, vehicle, type), test; slot buttons in `DayGrid`/`WeekGrid` |
| 6 Month/combined/phone | M `MonthView.tsx`, `CombinedView.tsx`; C `DayStrip.tsx`; phone FAB; tests |

## Testing Strategy

Strict TDD per WU: RED, then GREEN, then mutation-verify each fix.

| Layer | What |
|---|---|
| e2e (WU1, real Postgres) | Technicians aggregated and deactivated excluded. No-show admitted. Cancelled-from-open, cancelled booked before `appointment_at`, and cancelled with no history all excluded. New columns. Busy days across the 19:00-local/00:00-UTC edge. Next appointment. Since-time |
| Unit | Every pure helper in `items.ts` and `grid.ts`, including lanes, the out-of-hours window and NFD search |
| jsdom (`component-testing` skill) | Card text, the `data-categoria` attribute, `min-h-11` classes, detail actions per status, the toast text, the booking payload with/without `vehiculoId`/`categoria`, vehicle fetch failure ≠ empty |

Browser-only (green ≠ evidence), at `http://192.168.0.7:3000` from a tablet and a phone, light and dark:

- the popover is anchored and flips at the right edge;
- the sheet is reachable, with no hydration or console errors;
- the RSC boundary renders with real data;
- the now-line;
- 44 px on touch;
- each frame passes the owner's sign-off against the mockup.

## Threat Matrix

N/A: there is no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary.

## Migration / Rollout

No migration is required. Delivery is a chained tracker `feat/agenda-redesign`, and rollback is reverting the tracker merge.

## Open Questions

- [ ] None blocking. The `matchMedia` choice of popover vs sheet is a client event, so a tablet in portrait (≥768) gets the popover. Confirm on the device.
