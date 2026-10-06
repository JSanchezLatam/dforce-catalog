# Tasks: Mobile Responsive Pass

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5,800 total, estimated at tests = ~55% of lines (design's per-PR numbers treated as production lines, / 0.45): PR1 ~490, PR2 ~580, PR3 ~780, PR4 ~490, PR5 ~670, PR6 ~730, PR7 ~670, PR8 ~620, PR9 ~620, PR10 ~180; audit PNGs/PDF and `mockup/` renders excluded |
| 400-line budget risk | High (every PR except PR10 exceeds 400 by the 55% ratio; PR3 is the largest) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → … → PR10 in the design's order, each based on the previous branch off the draft tracker `feat/mobile-responsive-pass`. PR3 may split 3a primitives + guard / 3b page sweep by route group; PR6 may split 6a customers / 6b history tables |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (chain strategy resolved; owner accepted size:exception 2026-10-05 for every PR over 400 lines, the excess is mostly tests)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

RDD review note: the planning commit contains audit PNGs/PDF and `mockup/` renders, which overflow the lens budget. Every review MUST run `gentle-ai review status ... --next-transition` with `--base-ref <planning commit> --committed-only`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Colour pairs and contrast (#6 #7 #19-#22) | PR 1 (base: tracker) | `npx vitest run src/shared/ui src/components/ui` | LAN matrix; contrast measured | Revert PR 1 |
| 2 | 44px touch floor + Pagination + AGENTS.md | PR 2 (base: PR 1) | `npx vitest run src/components/ui src/shared/ui/Pagination` | LAN matrix; 1280 mouse unchanged; 768 touch | Revert PR 2 |
| 3 | `PageHeader`, `PAGE_HEADING`, `p-4 sm:p-8`, guard, inventory header | PR 3 (base: PR 2) | `npx vitest run src/shared/ui src/app/responsive-guards.test.ts "src/app/(app)"` | LAN matrix | Revert PR 3 |
| 4 | `PermissionDenied` across the refusal sites | PR 4 (base: PR 3) | `npx vitest run src/shared/ui/PermissionDenied "src/app/(app)"` | LAN as técnico | Revert PR 4 |
| 5 | `RecordCard` + service-orders cards | PR 5 (base: PR 4) | `npx vitest run src/shared/ui/RecordCard "src/app/(app)/service-orders"` | LAN matrix, overflow measured | Revert PR 5 |
| 6 | Customers cards + customer and vehicle history | PR 6 (base: PR 5) | `npx vitest run "src/app/(app)/customers"` | LAN matrix | Revert PR 6 |
| 7 | Inventory cards + desktop Precio/Stock columns | PR 7 (base: PR 6) | `npx vitest run "src/app/(app)/inventory" src/modules/inventory-view` | LAN matrix; 1280 columns | Revert PR 7 |
| 8 | Users cards | PR 8 (base: PR 7) | `npx vitest run src/modules/account` | LAN as administrador | Revert PR 8 |
| 9 | Per-screen fixes #3 #8 #13 #15 #16 #17b | PR 9 (base: PR 8) | `npx vitest run src/modules "src/app/(app)"` | LAN matrix; dialogs; 768 template preview | Revert PR 9 |
| 10 | Sidebar off-canvas breakpoint `lg` (#17a) | PR 10 (base: PR 9) | `npx vitest run src/components/ui src/hooks` | LAN at 768, 1024, 1280 | Revert PR 10 alone |

Rule for every task pair: RED test, confirm red BY NAME, GREEN, then mutation-verify (revert the fix, the named test goes red; a test that stays green is a placebo: repair or delete). Fixtures match the wire. Dual presentations: scope every row query with `within(getByTestId("<list>-table" | "<list>-cards"))` (jsdom applies no Tailwind, both are in the DOM) and add one same-count-in-both test per list. Class-string assertions are not layout evidence: the LAN check is.

Gates per PR: `npx tsc --noEmit`, `npm test`, `npm run lint` (0 errors, 14 warnings), `gga run --pr-mode --diff-only` with `PR_BASE_BRANCH` pinned to the previous PR's branch.

**LAN matrix** (named "matrix" below): `http://<lan-ip>:3000` from a second device; widths 390 / 768 / 1280 × dark / light × administrador / técnico. Force theme with `localStorage.theme` (next-themes ignores `colorScheme`) and confirm `<html class="dark">`. Per screen: `innerWidth` vs device width (`isMobile` Chrome widens `innerWidth` instead of scrolling), `scrollWidth <= innerWidth`, console clean, hit sizes measured. Contrast measured in the browser (mockup `measure()` method) and the value written in a comment beside the class, as `badge.tsx` does.

## WU1: Colour (PR 1) — #6 #7 #19 #20 #21 #22

- [x] 1.1 RED `StatusBadge.test`: every chip class carries a `dark:` twin from the mockup `CHIP` map. GREEN `StatusBadge.tsx`.
- [x] 1.2 RED `Toast` test: success and warning maps carry paired classes. GREEN `Toast.tsx`.
- [x] 1.3 RED `button` / `alert` tests: `destructive` contains `text-red-700 dark:text-red-400`. GREEN `button.tsx`, `alert.tsx`; same fix in `LogoutButton` and `InventoryCatalogHandoff` (`text-destructive` as text). (Button deviates on purpose: it uses the approved mockup's "Eliminar definitivamente" pair `bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300`, measured 8.32 dark / 5.54 light; Alert, FIELD_ERROR and the chips keep the shared `text-red-700 dark:text-red-400`.)
- [x] 1.4 RED `checkbox` test: border is `border-muted-foreground`, not `border-input`. GREEN `checkbox.tsx`.
- [x] 1.5 RED `InventoryStatsHeader` test: avatar uses `text-primary-foreground`, no `text-white`. GREEN.
- [x] 1.6 RED `styles.test`: `SUCCESS_TEXT` and `FIELD_ERROR` each carry a `dark:` pair. GREEN `styles.ts`; replace the 5 `text-green-600` copies (`PasswordForm:105`, `ProfileForm:71`, `WorkshopConfigForm:321`, `TemplateConfigForm:252`, `CatalogBuilderForm:965-966`).
- [x] 1.7 RED `ConfirmGenerateDialog` test: warning box has a `dark:` counterpart (no bare `bg-amber-50`). GREEN.
- [x] 1.8 Mutation-verify 1.1-1.7 by name (drop one `dark:` twin, restore `text-white`, restore `border-input`).
- [x] 1.9 (Measured 2026-10-05 at http://192.168.0.25:3000 on a card ground, dark / light: chips open 10.48/9.50, in_progress 10.05/6.36, done 10.63/6.48, failed 8.35/6.85; toast success 10.67/6.81; button destructive 8.32/5.54; FIELD_ERROR 6.67/6.42; SUCCESS_TEXT 10.83/4.95; catalog warning 10.37/6.84 (re-measured on the real amber-800/amber-50 classes; 19.19 was a wrong sample); Desactivado chip 6.47/5.62; checkbox border 7.52/4.83 (3:1 target).) Matrix; measure every listed element against its target (text >= 4.5:1, checkbox border >= 3:1, against the blended ground); write each value beside its class.

## WU2: Touch floor, Pagination (PR 2) — #5 #9 #10

- [x] 2.1 RED `button` test: `default` and `sm` include `pointer-coarse:min-h-11 pointer-coarse:min-w-11`. GREEN `button.tsx` (existing unconditional `min-h-11` call sites untouched).
- [x] 2.2 RED `input` / `select` tests: `pointer-coarse:h-11` on Input and SelectTrigger (filter-strip fields and buttons rise together on touch, "Limpiar" included). GREEN.
- [x] 2.3 RED `sidebar` tests: menu, sub-menu and group-label buttons carry `pointer-coarse:h-11`. GREEN `sidebar.tsx`.
- [x] 2.4 RED `checkbox` test: hit area `after:-inset-3.5`. RED `dialog` test: close X carries the coarse minimum and does not overlap the title. GREEN both.
- [x] 2.5 RED `Pagination.test`: `nav` has `flex-wrap`; items carry `pointer-coarse:h-11`; "Página X de Y" is `basis-full` below `sm`. GREEN `Pagination.tsx`.
- [x] 2.6 `AGENTS.md`: remove the "`shared/ui/Pagination.tsx`, still 28px" exception from the 44x44 paragraph and reword the filter-strip exception to fine pointers only.
- [x] 2.7 Mutation-verify 2.1-2.5 by name (remove one `pointer-coarse:` class, drop `flex-wrap`).
- [x] 2.8 (Measured 2026-10-05 at http://192.168.0.25:3000: 390 touch — /service-orders, /customers with the sidebar open and the Editar cliente dialog have every button, link, page number, checkbox hit area and the close X at ≥44x44, except the breadcrumb text link (52x20, carried to WU9); 768 touch — only the 16px SidebarRail (desktop-only, WU10) and the /builder category combobox trigger at 36px (carried to WU9); 1280 mouse — sidebar rows and buttons still 32px, unchanged.) Matrix; confirm 1280 with a mouse is pixel-unchanged; at 768 touch check `/builder` and every dialog (close X vs title); measure buttons, sidebar items, page numbers, close X, checkboxes >= 44x44.

## WU3: PageHeader, padding, inventory header (PR 3) — #1 #11 #12 #14

- [x] 3.1 RED `PageHeader.test`: title is an `h1`; actions sit in a wrapping container; subtitle only when given. GREEN `src/shared/ui/PageHeader.tsx` (no `"use client"`).
- [x] 3.2 RED `styles.test`: `PAGE_HEADING` is `text-2xl sm:text-[32px] leading-tight`. GREEN `styles.ts`.
- [x] 3.3 RED `src/app/responsive-guards.test.ts`: scans `src/app/(app)/**/page.tsx` for a bare `p-8` (red until the sweep). Print page and `loading.tsx` keep their own padding and are excluded. (Guard recognises `p-8` as a whole class only; the 14 scanned pages are every `page.tsx` but print.)
- [x] 3.4 Sweep: pages use `PageHeader` and `p-4 sm:p-8`, including the `catalogs/page.tsx:26` doubled margin. Split 3a/3b by route group if over budget. (14 pages: service-orders, customers, vencimientos, users, workshop-config, account, catalogs, builder, template-config, inventory, plus the 4 detail pages, which only take the padding. Refusal blocks got `p-4 sm:p-8` only; their sentence is WU4. Catalogs: the doubled margin was `CardContent className="p-6"`, dropped.)
- [x] 3.5 RED inventory page tests: title renders above the greeting; greeting is `hidden md:flex`; administrador keeps the stats card with "Sincronizar inventario" (fits on a phone); técnico sees the mockup layout (subtitle only). GREEN `inventory/page.tsx`, `InventoryStatsHeader.tsx`. (Subtitle `N productos sincronizados desde Interfuerza` is `md:hidden` and only for a user without the sync action; the stats card is `hidden md:block` for them. `ManualSyncButton` gained `max-sm:mb-0` so its desktop `mb-4` does not leave dead space in the stacked phone card.)
- [x] 3.6 Update existing heading assertions broken by the sweep; never loosen them to match both strings. (No existing assertion broke: the sweep kept every title, description and action string.)
- [x] 3.7 Mutation-verify 3.1-3.5 by name (reintroduce one `p-8`, move the greeting above the title).
- [x] 3.8 (Measured 2026-10-05 at http://192.168.0.25:3000, 390 touch, administrador and técnico × dark and light, 10 pages incl. both detail pages: innerWidth stays 390 on every page (was 462 on /service-orders), every h1 on one line; "Nueva orden de servicio" 179x44 fully visible (right edge 313); administrador's inventory stats card with "Sincronizar inventario" fits.) Matrix; "Órdenes de servicio" is one line and "Nueva orden de servicio" is fully visible at 44px at 390; no horizontal overflow.

## WU4: PermissionDenied (PR 4) — #18

- [x] 4.1 RED `PermissionDenied.test`: page title via `PageHeader`; "No tenés permiso para ver esta página"; "Pedile acceso a un administrador."; "Volver al inicio" links to `/` with `min-h-11`; lock icon. GREEN `src/shared/ui/PermissionDenied.tsx`. (Server component, `House`/`Lock` from lucide-react like the other pages. The `min-h-11` assertion is a whole-class check: `buttonVariants` already carries `pointer-coarse:min-h-11`, so a substring match survived the mutation.)
- [x] 4.2 RED `responsive-guards.test.ts`: the refusal literal outside `PermissionDenied` fails (red until the sweep). (Scans every page.tsx including print, unlike the padding guard.)
- [x] 4.3 Sweep every page.tsx holding the literal (grep finds 15, design says 16: locate the missing one) and pass each its page title; print and builder pages included. (15 pages swept, not 16: the grep was exhaustive, `rg "ver esta página" src` and a wider `permiso|forbidden|sin acceso` over every page.tsx find no other copy, no route handler renders it. The design's 16 was a miscount. Titles: the 10 PageHeader titles reused; detail pages got `Orden de servicio` (detail and print), `Cliente`, `Vehículo`, `Producto`. Every `can(user, ...)` call and early return is where it was.)
- [x] 4.4 Update the 7 page tests asserting the old sentence: `template-config`, `print`, `vencimientos`, `customers`, `service-orders/[id]`, `customers/[id]`, `service-orders`. (Each of the 7 now asserts the page h1, the h2 sentence and the `Volver al inicio` link to `/`; template-config already had the h1 line.)
- [x] 4.5 Mutation-verify 4.1-4.4 by name (change a string, keep one inline copy). (Red by name: Pedile string, href, Lock icon, sentence, PageHeader title, `min-h-11`, a page's title in vencimientos, one inline copy in users and in print.)
- [x] 4.6 (Checked 2026-10-05 at http://192.168.0.25:3000 as técnico, 390 touch, dark and light: /vencimientos, /users, /workshop-config, /builder, /template-config all show their own h1, the h2 "No tenés permiso para ver esta página", and "Volver al inicio" → `/` at 151x44; no overflow; console clean.) Matrix as técnico on `/vencimientos`, `/users`, `/workshop-config`, `/builder`, `/template-config` (390, both themes): identical look, differing only in title.

## WU5: RecordCard + service orders (PR 5) — #2

- [x] 5.1 RED `RecordCard.test`: `RecordCardList` is a `ul` with `md:hidden` and the given `data-testid`; `RecordCard` with `href` is one link, `action` slot renders outside the link, no checkbox. GREEN `src/shared/ui/RecordCard.tsx`.
- [x] 5.2 RED service-orders page tests (scoped `within`): table in `hidden md:block` card `service-orders-table`; cards in `service-orders-cards`; each card is one link to `/service-orders/<id>`; shows customer, `id.slice(0,8)`, plate, vehicle, status chip (`statusBadgeClassName`), Cita; same row count in both. GREEN `service-orders/page.tsx`.
- [x] 5.3 Mutation-verify 5.1-5.2 by name (drop `md:hidden`, render one fewer card, link only the title).
- [x] 5.4 (Checked 2026-10-05 at http://192.168.0.25:3000, 390 touch, administrador and técnico × dark and light: 9 cards, each ≥96px tall, scrollWidth = 390, table hidden, 0 visible checkboxes; tapping the bottom-right corner of a card opens that order; console clean. At 1280: cards hidden, table and its 10 checkboxes visible.) Matrix; no `scrollWidth` above the viewport; the whole card opens the order; bulk bar unreachable below `md`.

## WU6: Customers + history (PR 6) — #2 #4

- [x] 6.1 RED customers page tests (scoped): `customers-table` / `customers-cards`, card links `/customers/<id>`, no checkbox in any card, same count in both. GREEN `customers/page.tsx`.
- [x] 6.2 RED customer detail and vehicle detail tests: order-history table plus `RecordCardList` of the same orders, "Ver" reachable on the card, same count in both. GREEN both pages.
- [x] 6.3 (Mutated 2026-10-05, each red BY NAME: bar wrapper `hidden md:block`, card href, singular, `slice(1)` count, table `hidden`, Desactivado red, plate `font-mono`, green Activo, email in card, checkbox in card; detail pages: href, count, table `hidden`, category line.) Mutation-verify 6.1-6.2 by name.
- [x] 6.4 (Checked 2026-10-05 at http://192.168.0.25:3000, 390 touch, administrador and técnico × dark and light: /customers 10 cards with the green "Activo" chip, customer and vehicle history as cards, scrollWidth = 390, 0 visible checkboxes, 0 links or buttons past the right edge (the old off-screen "Ver" is gone); console clean.) Matrix; history "Ver" no longer off-screen; selection bar reachable only from `md`.

## WU7: Inventory cards + desktop columns (PR 7) — #2

- [x] 7.1 RED `table-sorting` delta: inventory `price` and `stock` headers render as plain text, no sort control; sortable set stays `id`, `name`, `categoryL1`, `categoryL2`. GREEN `inventory/page.tsx`; update the `queries.ts:82` comment.
- [x] 7.2 RED inventory tests (scoped): cards show name, code, `$x.toFixed(2)` price, stock ("Sin stock" with `failed` chip at 0, Activo `completed`); card links `/inventory/<id>`; same count in both; no checkbox. GREEN.
- [x] 7.3 Mutation-verify 7.1-7.2 by name (make `price` sortable, show `0` instead of "Sin stock").
- [x] 7.4 (Checked 2026-10-05 at http://192.168.0.25:3000, 390 touch, administrador and técnico × dark and light: 10 product cards ("3.8 SUPER TWEETER… PS0000570 $25.00 Sin stock"), scrollWidth = 390, 0 visible checkboxes; console clean. At 1280 the table headers read ID, Nombre, Categoría 1, Categoría 2, Precio, Stock, Acciones with no horizontal overflow.) Matrix; at 1280 the Precio/Stock columns show and nothing else moved; técnico (no row checkboxes) fits.

## WU8: Users cards (PR 8) — #2

- [x] 8.1 RED `UsersTable` tests (scoped): `users-table` / `users-cards`; card has no `href` and holds the existing `RowActions` kebab (Editar, Desactivar) in `action`; same count in both, also with "Mostrar inactivos". GREEN `UsersTable.tsx`.
- [x] 8.2 (Mutated 2026-10-05, each red BY NAME: card href, action slot dropped, bar wrapper `hidden md:block`, table `hidden`, cards `slice(1)`, cards ignoring "Mostrar inactivos", Desactivado shown as Activo, email in card, raw role key, checkbox in card. Existing table tests re-scoped to `users-table` because the kebab name and username now appear in both lists.) Mutation-verify 8.1 by name (link the card, drop the action slot).
- [x] 8.3 (Checked 2026-10-05 at http://192.168.0.25:3000 as administrador, 390 touch, dark and light: 2 user cards, no links on cards, kebab 44x44 inside the viewport (right edge 357), menu shows Editar / Desactivar (closed with Escape, nothing applied); no overflow; console clean.) Matrix as administrador; the kebab is 44px and reachable on a phone.

## WU9: Per-screen fixes (PR 9) — #3 #8 #13 #15 #16 #17b

- [ ] 9.w Observed in WU7 check (pre-existing, owner to confirm): opening /inventory as administrador re-shows the last sync's success toast ("Sincronización completada… 9/28/2026") on every visit.
- [ ] 9.v Carried from WU8: move the Desactivado chip classes to `shared/ui/styles` (copied into `UsersTable.tsx`); users table says "Inactivo" while cards say "Desactivado" — pick one word; at archive, correct `table-bulk-actions` spec lines that say the users card links to `/users/<id>` (no detail page; design overrides).
- [ ] 9.z Carried from WU6 review: scope the vehicle page's `getByRole("link", { name: /ver/i })` to `history-table` (a description like "Revisar frenos" would match a card too).
- [ ] 9.y Carried from WU3 review: /inventory desktop técnico gets an empty description `<p className="mt-1">` (only a `md:hidden` span) — drop the description when it can't show; `PAGE_HEADING` now adds `leading-tight` at desktop too — confirm desktop heading spacing unchanged.
- [ ] 9.x Carried from 2.8: breadcrumb links ≥44px tall on touch; /builder category combobox trigger (36px) to the touch floor; error toast `text-destructive-foreground` is not a registered utility (from WU1).
- [ ] 9.1 RED `CustomerForm` test: vehicle grid children carry `min-w-0` (Marca select no wider than its column). GREEN `CustomerForm.tsx:726`, `VehicleMakeModelFields.tsx`.
- [ ] 9.2 RED `InventoryStatsHeader` test: sync notice wraps (no truncation classes). GREEN.
- [ ] 9.3 RED customer detail test: header is `flex-col sm:flex-row`. GREEN `customers/[id]/page.tsx:84`.
- [ ] 9.4 RED order detail test: title and breadcrumb show `id.slice(0,8)`. GREEN `service-orders/[id]/page.tsx`.
- [ ] 9.5 RED `WorkshopConfigForm` tests: social rows stack on phones; file control is a Spanish-labelled button with no native "Choose File". GREEN.
- [ ] 9.6 RED `TemplateConfigForm` test: cover preview container does not clip at 768. GREEN `TemplateConfigForm.tsx:262`. No phone layout for `/builder` or `/template-config` (markup unchanged at phone size).
- [ ] 9.7 Mutation-verify 9.1-9.6 by name.
- [ ] 9.8 Matrix on the dialogs (nueva/editar orden and cliente, vehicle tab) and `/workshop-config` at 390; `/template-config` at 768; re-run the audit.

## WU10: Sidebar breakpoint (PR 10, alone) — #17a

- [ ] 10.1 RED `use-mobile` test: breakpoint is 1024. GREEN `use-mobile.ts`.
- [ ] 10.2 RED `sidebar` tests: off-canvas classes use `lg:` not `md:`; top bar is `lg:hidden`; `SidebarRail` stays desktop-only. GREEN `sidebar.tsx` and the top bar.
- [ ] 10.3 Mutation-verify 10.1-10.2 by name (restore 768, restore `md:`).
- [ ] 10.4 Matrix at 768, 1024 and 1280: tablets get the menu button; desktop sidebar unchanged at 1280; hydration console clean.

## Final gate and archive notes

- [ ] 11.1 Re-run the audit at 390 in all four role/theme combinations: 0 findings, no `scrollWidth` over the viewport, all action controls >= 44x44 on touch, 1280 list pages unchanged.
- [ ] 11.2 At archive: merge `responsive-layout` (new capability); apply `table-bulk-actions` (ADDED Phone Card Layout, Selection Is Tablet-Plus Only; MODIFIED Cross-Page Checkbox Selection) and `table-sorting` (MODIFIED Per-Table Sortable Column Whitelist). Check for duplicates after the mechanical apply.
- [ ] 11.3 Follow-ups, not in scope: `/builder` and `/template-config` phone layouts; bulk selection on phone cards.
