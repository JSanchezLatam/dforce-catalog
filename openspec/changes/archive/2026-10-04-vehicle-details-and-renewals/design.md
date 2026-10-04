# Design: Vehicle Details and Renewals

## Technical Approach

New columns on `vehiculo`, written through the existing `customers/vehicles.ts` owner. Internal fields are tri-state on update and refused at the route for callers without `vencimientos.read`. A pure `vencimientos/due.ts` filters SQL candidates in Panamá time. The page count and the sidebar badge both come from the same `getDueVencimientos(now)` call.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Columns | `chasis`, `color_primario`, `color_secundario`, `estilo`, `numero_unidad` text; `motor` pgEnum `vehiculo_motor` (`combustion`,`electrico`,`hibrido`); `placa_renovacion_mes` smallint + `check()` 1..12; `seguro_vence` `date({ mode: "string" })` | `estilo` as pgEnum | A curated list that changes should need a code change, not an append-only enum. Validate it against `ESTILO_OPTIONS` |
| Migrations | `drizzle-kit generate --name vehiculo_details` (0021), `--name vehiculo_contacto` (0022). No hand-written SQL | Hand SQL | Repo convention. First `check()` in the schema, so confirm the CHECK appears in the generated SQL |
| Preservation | Internal columns are tri-state in `applyVehiculoPlan` UPDATE: `undefined` = not in SET, `null` = clear, value = set. Public columns keep `?? null` because `CustomerForm` round-trips them | Passing a `writeInternal` role flag into the data layer | Omitting a field can never wipe it, whoever calls. One rule, and nothing to forget to thread through |
| Refusal | Raw-body check `sendsInternalVehiculoFields(body)` (key `!== undefined`, so `null` counts) in `POST /api/customers` and `PATCH /api/customers/[id]` → **403** `{error:"Forbidden"}` when `!can(user,"vencimientos.read")`. It runs before validation, which is how `asksForVehicleDeletion` already works. `POST /api/customers/[id]/vehicles` adds both keys to `COLLECTION_ONLY_FIELDS` and answers **400** for everyone | Silently stripping the fields | This repo refuses input it will not write, and a technician sending `null` must not be able to clear a stored value |
| Public shape | `toPublicVehiculo(v)` in `vehicles.ts` builds an **allowlist** object. `PublicVehiculo = Pick<Vehiculo, …>` | `Omit` of the internal fields | A column added later stays hidden by default. Used by GET and POST `/vehicles`, and by `customers/[id]/page.tsx` when the viewer lacks `vencimientos.read`, because the full row would otherwise reach the client through the `CustomerFormTrigger` RSC payload |
| Order/print | Named-field allowlist (existing). No mapper | Mapper on these pages | Both are server components that render named fields only. Poisoned fixtures prove it |
| Contactado | Table `vehiculo_contacto(vehiculo_id FK cascade, kind pgEnum vencimiento_kind[placa,seguro], period_key text, contacted_at timestamptz default now, contacted_by FK users set null)`, **composite PK** on the first three. Insert `.onConflictDoNothing()` | Surrogate id + unique index | The PK is the uniqueness rule, so no column goes unused |
| Due rules | Pure, with injected `todayKey`. Plate: month index `t=y*12+m-1`, occurrence `k` = the largest `≤ t+1` with `k%12 = M-1`; due if `k ≥ t`, overdue if `k < t`. `period_key = YYYY-MM` of `k`, so December→January wraps through the index arithmetic. Insurance: due if `seguro_vence ≤ today+30d` (overdue if `< today`), `period_key = seguro_vence` | SQL date math | Pure code can be unit-tested and mutation-verified. SQL only filters candidates |
| Today | `toWorkshopDateKey(now)` in `shared/datetime.ts` via `Intl.DateTimeFormat("en-CA",{timeZone:"America/Panama"})`. Comparisons use strings only, never parsed `Date`s | `new Date()` local fields | The server may run in UTC. Parsing a date-only string is off by one day (see `datetime.ts`) |
| Badge | `(app)/layout.tsx` counts with `can(user,"vencimientos.read")` and passes `getNavGroups(user, { "/vencimientos": n })`. `NavLink.badge?: number`. Expanded sidebar: `SidebarMenuBadge` plus an sr-only count inside the link. Collapsed icon rail (where the badge is hidden): an aria-hidden dot on the icon, and the tooltip `Vencimientos próximos (n)`. Mobile uses the offcanvas sheet, so it shows the full badge | Client polling | The count refreshes on load and on `router.refresh()`. Staleness across machines is accepted (no poll, YAGNI) |
| Contact message | Pure `vencimientos/message.ts`: `buildContactMessage({workshop, customerName, vehicle, item, price})`, `formatBalboa(n)` = `` `B/. ${n.toFixed(2)}` ``, `waMeUrl(digits, text)` = `` `https://wa.me/${digits}?text=${encodeURIComponent(text)}` ``. No server imports, so the client dialog imports it and the preview updates as the price is typed. Null workshop fields drop their sentence/fragment (`le saludamos de {taller}`, `o llámenos al {teléfono}`, `Horario: …`, `Dirección: …`); `price` null or `NaN` drops ` por B/. …`; no make and model → `vehículo`. `{mes}` = Spanish month name + year from `period_key`; insurance date `dd/mm/aaaa` by splitting the key string, never a parsed `Date` | Building the text server-side | The price is typed in the dialog. Pure code is unit- and mutation-testable |
| WhatsApp phone | Reuse `toE164` from `src/modules/reminders/providers/whatsapp.ts` (adds `507` to an 8-digit `6…` Panamá mobile, keeps a declared `+` country, refuses landlines and malformed lengths). Called in the **page** (server), the `+` stripped for `wa.me`. That module imports the Kapso SDK and `env`, so it never enters the client bundle | A second normaliser; moving `toE164` to a shared file | One phone rule for reminders and this link. Calling it server-side avoids touching the reminders module |
| WhatsApp button | `<a target="_blank" rel="noopener noreferrer">` styled as a 44x44 `Button`. Disabled when `whatsappOptOut` ("El cliente pidió no recibir WhatsApp", checked first, legal consent; `emailOptOut` is not read) or when `toE164` refuses (copy below, Open Questions). Opening it is not a mutation: no request, no toast, item stays listed. "Correo" is a disabled button with "Próximamente". "Marcar como contactado" is the existing contact POST, toast above `router.refresh()`, both below the `try/catch` | `window.open`, clipboard copy | A plain link needs no secure-context API (LAN over HTTP) and `wa.me` hands off to WhatsApp Desktop or Web itself |
| Dialog props | The page passes per row `{vehiculoId, kind, periodKey, overdue, customerName, placa, vehicleLabel: string \| null, waPhone: string \| null, waBlockedReason: string \| null}` and once `workshop: {name, phone, hours, address}` (each `string \| null`). Opt-out is resolved to `waBlockedReason` on the server, so neither opt-out flag, the raw stored phone, nor any other `cliente`/`vehiculo`/`workshop_config` column reaches the client | Passing the rows / config objects whole | RSC payload carries only what the dialog renders or links. The due item itself is visible to this viewer (`vencimientos.read`) |
| Query owner | `vencimientos/queries.ts` reads `vehiculo` read-only (a third import site). Amend the `vehicles.ts` header the way D7 did | Moving the query into `vehicles.ts` | It joins `cliente` and `vehiculo_contacto`, so it belongs to this feature |

## Data Flow

    CustomerForm ─PATCH─> route (403 gate) ─> updateCliente ─> applyVehiculoPlan (tri-state)
    /vencimientos page ┐
    (app)/layout badge ┴─> getDueVencimientos(now) ─> queries (candidates + contacts) ─> due.ts filter
    /vencimientos page ─getWorkshopConfig + toE164 (server)─> ContactDialog props
    ContactDialog ─buildContactMessage─> preview ─waMeUrl─> <a target=_blank> (no request)
    ContactDialog "Marcar como contactado" ─POST /api/vencimientos/contact─> insert ON CONFLICT DO NOTHING ─> toast ─> router.refresh()

Candidates: active `vehiculo` ⋈ active `cliente`, at least one internal field not null. The candidate row also selects `cliente.name`, `cliente.phone`, `cliente.whatsappOptOut`, `vehiculo.make`/`model`/`plate` for the dialog. Contacts load whole. `ponytail:` restrict them by vehicle id if the table grows.

## Routes (`ROUTE_GUARDS`)

| Key | Entry |
|---|---|
| `/api/customers` | `POST: ["customers.write","vencimientos.read"]` |
| `/api/customers/[id]` | `PATCH: ["customers.write","customers.deleteVehicle","vencimientos.read"]` |
| `/api/vencimientos/contact` | `POST: "vencimientos.contact"` (body `{vehiculoId,kind,periodKey}`; format checked per kind → 400; missing vehicle → 404; 200 on insert or duplicate) |
| `/vencimientos` | `GET: "vencimientos.read"` |

`vencimientos.read` lands in PR1 because the PATCH evaluates it. `vencimientos.contact` lands in PR3. Grants: administrador true, tecnico false.

## File Changes (by PR, chained)

| PR | Files | Est. |
|---|---|---|
| 1 | `schema.ts`, migration 0021, `validation.ts`, `vehicles.ts`, `vehicle-options.ts` (new, client-safe `ESTILO_OPTIONS`/`MOTOR_LABEL`/months), 3 customer routes, `policy.ts`, `route-guards.test.ts`, `CustomerForm.tsx`/`CustomerFormTrigger.tsx` (`canEditInternal`), `customers/[id]/page.tsx`, vehicle detail page, `ServiceOrderForm.tsx` type, e2e | ~400 (may split server/form) |
| 2 | order detail + print pages, poisoned tests | ~150 |
| 3 | migration 0022, `datetime.ts`, `vencimientos/{due,queries,service}.ts`, contact route, policy/guards, e2e | ~350 |
| 4 | `(app)/vencimientos/page.tsx` (list only), `nav-items.ts`, `app-sidebar.tsx`, `layout.tsx` | ~250 |
| 5 | `vencimientos/message.ts` + tests (~170), `ContactDialog.tsx` + test (~220), page wiring (~20) | ~410 |

The dialog adds ~360 lines to the former PR4 (~300 → ~660), over the 400 budget, so it splits: PR4 ships the list and badge, PR5 the dialog (which replaces `ContactadoButton`). If PR5 runs over, `message.ts` goes first as its own PR.

## Testing Strategy

| Layer | What |
|---|---|
| Unit | `due.ts`: Dec→Jan, Nov→Dec, overdue, 30-day edge, contacted key hides, new expiry resurfaces. Validation bounds. Plan tri-state (mutation: restore `?? null` → red). Mapper allowlist. Route 403 when `null` is sent. `message.ts`: price present/absent (no ` por B/.`), `B/. 45.00`, insurance overdue `venció el` vs `vence el`, null workshop fields omitted, missing make/model → `vehículo`, `waMeUrl` encodes spaces, accents, `/` and `.` |
| Component | Form hides the internal section for a technician and sends no internal keys. Order detail and print use sentinel internal values and assert they are absent. Toast precedes refresh. Dialog: opt-out disables WhatsApp with its reason, "Correo" disabled, the WhatsApp `href` is the `wa.me` URL with `target="_blank"`, clicking it sends no request and shows no toast |
| E2E (real SQL) | PR1: a technician PATCH keeps stored values, an admin `null` clears them, `seguro_vence` round-trips as a string, the CHECK rejects 13. PR3: candidates exclude deactivated vehicles and customers, a double contact insert leaves one row, a contacted item drops out |
| Browser (LAN IP) | The PR4 page on mobile, the badge in the rail, and the RSC boundary. PR5: the WhatsApp link opens `wa.me` from another machine (insecure context) with the message intact. PR2 print preview (more rows could push the signature to page 2) |

## Threat Matrix

N/A: no shell, subprocess, VCS/PR automation, or executable-file boundary. The HTTP authorization is covered above.

## Migration / Rollout

Both migrations are additive. To roll back, revert in reverse order.

## Open Questions

- [x] Overdue plate lookback (owner, 2026-10-04): a plate stays overdue for two months after its renewal month; three or more months past, it is not listed and returns in next year's cycle (a plate entered in October with month 3 waits for 2027-03). With `y*12+m-1` indices this is `today - 2 <= occurrence <= today + 1`, picking the occurrence nearest that window.
- [x] `ESTILO_OPTIONS` values: approved with the mockup 2026-10-04 (spec).
- [x] Disabled-WhatsApp copy when `toE164` refuses the phone (a landline or malformed number): "El teléfono del cliente no es un celular". Approved by the owner 2026-10-04.
- [x] Overdue plate wording: "corresponde en {mes}" when due, "correspondía en {mes}" when overdue, mirroring insurance's "venció el". Approved by the owner 2026-10-04.
