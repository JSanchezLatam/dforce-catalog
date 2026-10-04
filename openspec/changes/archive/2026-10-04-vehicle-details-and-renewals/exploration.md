# Exploration: Vehicle Details and Renewals

Round-2 step 1 (owner grill 2026-10-03). Vehicle fields plus a "Vencimientos próximos" page.

## Current state

- `vehiculo` (`src/shared/db/schema.ts:389`) has only `make`, `model`, `year`, `plate`, `deactivatedAt`, `createdAt`. None of the requested fields exist.
- REVISADO exists only as an order category and as the 365-day `service_due` reminder (`src/modules/reminders/schedule.ts`). Nothing stores a plate-renewal month, so there is nothing to reuse or deduplicate.
- Vehicle reads/writes are owned by `src/modules/customers/vehicles.ts`. `applyVehiculoPlan` writes every column as `x ?? null` on each save: any form that does not round-trip a new field wipes it.
- Write paths: `PATCH /api/customers/[id]` (reconcile in `customers/service.ts`), `POST /api/customers/[id]/vehicles` (four keys), `VehicleQuickForm.tsx` (four keys, pinned by a test), `CustomerForm.tsx` (`VehiculoRow`, `buildPayload`).
- Display: vehicle detail page (chips), order detail (plate link), print sheet (named allowlist: Placa, Marca, Modelo, Año), order list query (`service-orders/queries.ts:167`, named columns).
- `GET /api/customers/[id]/vehicles` returns whole rows; with internal columns it would leak them to every `customers.read` caller. It must map to an explicit public shape.

## RBAC and navigation

- `roleEnum` is `["tecnico","administrador"]`. `MATRIX` in `src/modules/auth/policy.ts` is typed so every Action needs a grant per role (compile-time).
- `route-guards.test.ts` requires a `ROUTE_GUARDS` entry per page/route, every Action used, and a literal `can(user, "x")` call.
- Nav: `src/modules/layout/nav-items.ts` (`getNavGroups(user)`, pure). No existing counter; shadcn `SidebarMenuBadge` exists unused and is hidden in the icon rail.
- Gate now with Actions `vencimientos.read` and `vencimientos.contact` (admin true, tecnico false). Step 3 adds `jefe_taller` and the compiler forces its grants.

## Recommended data model

- Columns on `vehiculo`: `chasis` text, `color_primario`, `color_secundario`, `estilo` text (curated list), `motor` pgEnum (`combustion`, `electrico`, `hibrido`), `numero_unidad` text, internal `placa_renovacion_mes` smallint CHECK 1..12, internal `seguro_vence` date in string mode (`src/shared/datetime.ts`: a date-only value parsed as `Date` renders a day off in Panamá).
- "Contactado": table `vehiculo_contacto(vehiculo_id, kind, period_key, contacted_at, contacted_by)`, UNIQUE on the first three, `ON CONFLICT DO NOTHING`. `period_key` is `YYYY-MM` for the plate and the expiry date for insurance, so a new expiry resets naturally.
- Due list computed on open: SQL fetches candidates, a pure module filters in Panamá time.
- Badge counted in `(app)/layout.tsx` when `can(user, "vencimientos.read")`; fresh on load and after `router.refresh()`.

## Proof that internal fields stay internal

The order detail and print pages render an allowlist. Add poisoned-fixture tests (sentinel values in internal fields, assert absent), mutation-verified, plus the public mapper on the GET route.

## Size

About 1,100–1,400 lines with tests: chained PRs.

1. Migration, schema, validation, `vehicles.ts`, `CustomerForm`, vehicle detail, public mapper (~350–400).
2. Non-internal fields on order detail and print, exclusion tests (~150).
3. Due module, `vehiculo_contacto` migration, query, contact route, Actions, e2e row (~350).
4. `/vencimientos` page, Contactado button with toast, nav item and badge (~300).

## Open questions for the owner

1. Window for "próximo": plate and insurance; show overdue? **Answered 2026-10-03:** plate due when its renewal month is the current or next month; insurance due within 30 days; overdue items stay listed until marked "Contactado".
2. Do the new non-internal fields print on the sheet and show on the order? **Answered 2026-10-03:** yes, on order detail and the printed sheet beside plate/make/model/year; unit number only when filled; internal fields never.
3. Who edits the internal fields: anyone with `customers.write`, or admin (and later jefe) only? **Answered 2026-10-03:** only roles holding the vencimientos permission see and edit them. Technicians neither see nor edit them: the form section is conditional, the server refuses them from a technician, and a technician's save must PRESERVE the stored values (not `?? null` them — see the wipe-on-save risk).
4. Does `jefe_taller` also mark Contactado? Resolved without asking: the grill already gives the page to admin + jefe, and Contactado is the page's only action, so both permissions travel together.

## Risks

- Wipe on save via `applyVehiculoPlan`.
- Real SQL invisible to the unit suite: e2e rows required.
- Server→client boundary on the page: verify in a browser at the LAN IP, including mobile.
- `motor` enum is append-only.
