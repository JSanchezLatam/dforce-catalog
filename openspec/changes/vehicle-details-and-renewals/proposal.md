# Proposal: Vehicle Details and Renewals

## Intent

Round-2 step 1 (owner grill 2026-10-03). The workshop records only plate, make, model and year per vehicle, so the order and the printed sheet cannot identify a unit fully, and nobody tracks when a customer's plate or insurance is due — a missed chance to bring the car in. Owner answers in `exploration.md` are final.

## Scope

### In Scope
- Vehicle fields: chasis, primary/secondary color, estilo, motor (combustión/eléctrico/híbrido), unit number (optional). Shown on order detail and the printed sheet beside Placa/Marca/Modelo/Año; unit number only when filled.
- Internal fields: plate renewal month, insurance expiry date. Visible and editable only with `vencimientos.read`; never on the order, the sheet, or `GET /api/customers/[id]/vehicles` (explicit public mapper). The server refuses them from a technician, and a technician's save preserves the stored values.
- "Vencimientos próximos" page: computed on open; plate due when its renewal month is the current or next month; insurance due within 30 days; overdue stays until "Contactado". One "Contactado" per vehicle, kind and period (`vehiculo_contacto`), with the success toast and 44x44 targets. Sidebar counter badge; responsive.
- Row action "Contactar" (owner decision 2026-10-04) opens a dialog: optional "Precio" (B/., e.g. `B/. 45.00`), a read-only message preview built by a pure function from `workshop_config` + vehicle + due item, a "WhatsApp" button (plain `https://wa.me/<digits>?text=…` link in a new tab; disabled with "El cliente pidió no recibir WhatsApp" when `whatsappOptOut`), a disabled "Correo" button labelled "Próximamente", and "Marcar como contactado" (the Contactado mutation). Opening WhatsApp does NOT mark contacted.
- Actions `vencimientos.read` / `vencimientos.contact`: administrador true, tecnico false.

### Out of Scope
- `jefe_taller` role (step 3 adds its grants).
- Notifications, scheduled jobs, editable reminders.
- `VehicleQuickForm` (stays four keys).
- Sending email (the "Correo" button is a disabled placeholder) and sending WhatsApp through Kapso; the dialog only opens a `wa.me` link the operator sends by hand.

## Capabilities

### New Capabilities
- `vehicle-renewals`: due-list rules, Contactado per period, page, permissions, sidebar badge.

### Modified Capabilities
- `customer-management`: new vehicle fields and validation; internal-field visibility, refusal and preservation on save; public vehicle shape on the GET route.
- `service-orders`: order detail and Printable Work Order show the non-internal fields and never the internal ones.

## Approach

Per `exploration.md`: columns on `vehiculo` (`motor` pgEnum, `placa_renovacion_mes` smallint CHECK 1..12, `seguro_vence` date in string mode). `applyVehiculoPlan` stops writing `?? null` for internal columns a caller did not send. Due list: SQL candidates plus a pure filter in Panamá time. Contact insert uses `ON CONFLICT DO NOTHING`; `period_key` (`YYYY-MM` or expiry date) resets naturally on a new period. Badge counted in `(app)/layout.tsx`.

Five chained PRs: (1) schema, validation, `vehicles.ts`, `CustomerForm`, vehicle detail, public mapper; (2) order detail and print with poisoned-fixture exclusion tests; (3) due module, `vehiculo_contacto`, contact route, Actions, e2e row; (4) page and nav badge; (5) contact message builder and "Contactar" dialog. The phone goes through the existing `toE164` (`reminders/providers/whatsapp.ts`), server-side.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/db/schema.ts`, new migrations | Modified/New | Columns, enum, `vehiculo_contacto` |
| `src/modules/customers/` (`vehicles.ts`, `service.ts`, `CustomerForm.tsx`), `src/app/api/customers/[id]/` | Modified | Fields, gating, preservation, mapper |
| `src/modules/service-orders/`, order detail and print pages | Modified | Display allowlist |
| `src/modules/auth/policy.ts`, `route-guards` | Modified | Two Actions |
| `src/modules/vencimientos/`, `src/app/(app)/vencimientos/`, contact route | New | Due list, page, Contactado, message builder, Contactar dialog |
| `src/modules/reminders/providers/whatsapp.ts`, `src/modules/workshop-config/service.ts` | Read only | `toE164` and `getWorkshopConfig` reused, unchanged |
| `src/modules/layout/nav-items.ts`, `src/app/(app)/layout.tsx` | Modified | Nav item, badge |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Technician save wipes internal fields | High | Preserve-on-omit; mutation-verified test plus e2e row |
| Internal fields leak via order/print/GET | Med | Poisoned-fixture tests, public mapper |
| Real SQL unseen by unit suite | High | e2e rows for due query and contact insert |
| RSC boundary or mobile layout breaks | Med | Browser check at the LAN IP |
| `motor` enum is append-only | Low | Values fixed by owner |
| WhatsApp offered to an opted-out customer | Low | Button disabled on `whatsappOptOut`; component test mutation-verified |

## Rollback Plan

Revert slices in reverse order. Slices 3–5 drop cleanly (the table only holds contact marks). Slice 1 migration is additive; a down migration drops the columns, losing only data entered since.

## Dependencies

- Owner-approved mockup of "Vencimientos próximos" — approved 2026-10-04.

## Success Criteria

- [ ] New fields appear on order detail and print; internal fields never do (sentinel tests red when the allowlist is broken).
- [ ] A technician's save leaves stored internal values intact; a technician sending them is refused.
- [ ] Due list matches the window rules in Panamá time; Contactado hides the item until the next period.
- [ ] Badge count equals the page's row count; technicians see neither.
- [ ] "Contactar" builds the message with and without a price, the WhatsApp link opens without marking contacted, and an opted-out customer gets no WhatsApp button.

## Proposal question round

Owner questions were answered 2026-10-03 (`exploration.md`). The mockup was approved by the owner 2026-10-04, settling the former assumptions: estilo list Sedán, Hatchback, SUV, Pick-up, Van/Panel, Coupé, Moto, Otro; colors are free text; the badge counts due-and-not-contacted items (a vehicle due on plate and insurance counts 2). The "Contactar" dialog is an owner decision of the same date, and its two copy details were approved the same day (see `design.md` Open Questions).
