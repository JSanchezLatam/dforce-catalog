# Mobile audit — final gate (task 11.1)

**Result: 20 Fixed, 2 Changed (improved, not fully closed), 0 Still present. 6 new findings
(0 Bloquea, 3 Molesta, 3 Cosmético).** No screen in the matrix overflows: `innerWidth` and
`scrollWidth` equal the device width (390 or 768) on all 86 screens, both accounts, both themes.

Measured 2026-10-05 against `feat/mobile-sidebar-tablet` @ 8d04a7f (tip of the 10-PR chain),
dev server at `http://192.168.0.25:3000` (LAN IP), Playwright Chromium, `isMobile` +
`hasTouch`. Same matrix and screen list as `audit.md`: administrador and técnico × dark and
light, phones at 390x844, `/builder`, `/template-config` and the sidebar also at 768x1024.
86 screenshots plus 4 scrolled-dialog shots (kept outside the repo, in the session scratchpad
`final-audit/`). Theme forced through `localStorage.theme`; `<html class="dark">` matched the
intended theme on all 86. Read-only: dialogs opened and closed with Escape, nothing submitted.

## The 22 original findings

| # | Status | Evidence (measurement) | Cuenta / Tema |
|---|---|---|---|
| 1 | **Fixed** | /service-orders `innerWidth` 390 = `scrollWidth` 390 (was 462); no interactive element past the right edge; no heading over one line; "Nueva orden" dialog 390/390. | todas |
| 2 | **Fixed** (phone) | At 390 /customers, /service-orders, /inventory, /users render one card per row; 0 visible tables, 0 clipped controls. Order cards show Estado (badge) and Cita (`service-orders/page.tsx:278`). Tablet portrait still gets the wide table → see **N1**. | todas |
| 3 | **Fixed** | Editar cliente, before and after scrolling to the vehicle block: page 390/390, 0 controls clipped or past the edge. | todas |
| 4 | **Fixed** | /customers/[id] and vehicle detail: 0 controls past the edge, 0 tables wider than their box. | todas |
| 5 | **Fixed** | "Página 1 de 39/72" one line (20px, not truncated); page buttons 44x44, "Siguiente" 84x44 on /customers and /inventory. | todas |
| 6 | **Fixed** | Badges: dark "En progreso" 10.05, "Completada" 10.63, "Cancelada" 10.48, "Sin stock" 8.35; light 6.36 / 6.48 / 9.5 / 6.85. Toast success is now `text-green-800 dark:text-green-300` on green-50/950 (`Toast.tsx:19,25`). | todas |
| 7 | **Fixed** | "Eliminar definitivamente" dark 6.45:1 (8.32 on the deactivated vehicle), light 5.06 / 5.54; 203x44. | admin |
| 8 | **Fixed** | Stats card: "712 / sincronizados desde Interfuerza" `scrollWidth` = `clientWidth` (334); the "Completada" pill sits on its own line, untruncated. The finished-sync banner now shows only when the page saw the sync run (9d1f2da), so a visit cannot show it. | admin |
| 9 | **Fixed** | Open sidebar at 390 and 768: 0 menu items under 44px. | todas |
| 10 | **Fixed** | 0 buttons under 44x44 anywhere in the matrix, including dialog close X, "Agregar red social" (131x44), Guardar/Cancelar, Vista previa/Descargar/Imprimir. Remaining sub-44 controls are not buttons: see **N2**, **N3**. | todas |
| 11 | **Fixed** | 0 `h1`/`h2`/card or dialog titles over one line on all 86 screens. | todas |
| 12 | **Changed** | Page margin is now 16px (`h1` left = 16, was 32). /catalogs still nests the catalog cards inside a page `Card` (`src/app/(app)/catalogs/page.tsx:27-28`): ~32px lost per side there. | todas |
| 13 | **Fixed** | /customers/[id] title one line; no heading wraps. | todas |
| 14 | **Changed** | Greeting and avatar are gone, "Inventario" is the first thing on the page (top 85px). But the five filters are still stacked: first product starts at y = 766 of 844 for admin, 614 for técnico — almost a screen of chrome. `src/modules/inventory-view/InventoryFilters.tsx`. | todas |
| 15 | **Fixed** | Title "Orden 2adc07ff", breadcrumb "Órdenes de servicio › 2adc07ff" — short id, no split. | todas |
| 16 | **Fixed** | Social inputs 324px wide, text not truncated (`scrollWidth` = `clientWidth`); 0 visible native file inputs, so no "Choose File". | admin |
| 17 | **Fixed** | At 768 the sidebar is off-canvas (`sidebar-container` hidden), `main` is 768 wide from x = 0 on /builder and /template-config; preview cover fully visible, 0 elements past the edge. | admin |
| 18 | **Fixed** | All five refusals (/vencimientos, /users, /workshop-config, /builder, /template-config) now render the same thing: title + "No tenés permiso para ver esta página" + "Pedile acceso a un administrador." + "Volver al inicio" (`src/shared/ui/PermissionDenied.tsx`). | técnico |
| 19 | **Fixed** | The avatar circle no longer exists on /inventory (0 matches in dark or light). | todas · oscuro |
| 20 | **Fixed** | Checkbox border light 4.40-4.83:1 (dark 5.81-7.52), hit area 44 via `::after` (`-inset-3.5`). On phone the lists are cards and show no row checkboxes. | todas · claro |
| 21 | **Fixed** (code) | 0 `text-green-600` left in `src/`; replaced by `SUCCESS_TEXT = "text-green-700 dark:text-green-400"` (`src/shared/ui/styles.ts:31`). | todas · claro |
| 22 | **Fixed** (code) | `ConfirmGenerateDialog.tsx:44` now carries `dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-300`. | admin · oscuro |

## New findings

| # | Pantalla | Cuenta / Tema | Severidad | Problema (para el dueño) | Dónde en el código |
|---|---|---|---|---|---|
| N1 | /customers, /service-orders, /inventory a 768 (tablet vertical) | admin (técnico igual) · ambos | **Molesta** | En una tablet vertical vuelve la tabla de escritorio y no entra: 766px (Clientes), 988px (Órdenes), 833px (Inventario) dentro de una caja de 680px. El botón "⋯" de cada fila queda en x = 786 / 1009 / 853, fuera de la caja (borde 724): hay que deslizar la tabla de costado, que es el #2 original a otro ancho. /users entra justo (680). Fuera de la matriz original (las listas se midieron solo a 390), pero el taller usa tablets. | Corte de tarjeta/tabla en `md` (768): `customers/page.tsx:171,249`, `service-orders/page.tsx:146,181`, `inventory/page.tsx:139,161` (`hidden md:block`) |
| N2 | Diálogos Editar cliente (vehículo), Nueva orden, Editar orden | todas | **Molesta** | Los desplegables nativos (Estilo, Motor, Mes; Vehículo, Categoría) miden 32px de alto (132x32, 119x32, 310x32): los campos de texto ya suben a 44 en pantalla táctil, estos no. | `src/modules/customers/CustomerForm.tsx:779,795,834` (`NATIVE_FIELD` sin alto táctil); `src/modules/service-orders/ServiceOrderForm.tsx:401-403,479-481` (`h-8`) |
| N3 | /users — casilla "Mostrar inactivos" | admin · ambos | **Molesta** | Casilla nativa de 16x16; la etiqueta al lado amplía el ancho pero no la altura. | `src/modules/account/UsersTable.tsx:205-211` (`<input type="checkbox" className="h-4 w-4">`) |
| N4 | Menú lateral — títulos de grupo "CRM", "Catálogo", "Configuración" | todas · **solo claro** | Cosmético | 4.28:1 (mínimo 4.5). En oscuro 8.41. Ya estaba antes del cambio; la primera auditoría no lo midió. | `src/components/ui/sidebar.tsx:403` (`text-sidebar-foreground/70`) |
| N5 | Ficha del cliente y Editar cliente (vehículo desactivado), /login (pie) | todas · **solo claro** | Cosmético | Texto gris sobre gris claro a 4.40:1: la placa y "Vehículo desactivado" en la tarjeta de vehículo desactivado, y "Desarrollado por Jorge Sanchez". La segunda línea del pie ("Versión 1.0…", `opacity-75`) es más clara y no se midió. Ya estaba antes. | `src/shared/ui/styles.ts:19` (`CARD_MUTED`: `bg-muted text-muted-foreground`), usado en `customers/[id]/page.tsx:186-188` y `CustomerForm.tsx:639`; `src/app/login/page.tsx:58-60` |
| N6 | /service-orders/[id] — enlaces "Rosa Martínez" y "XYZ-999" | todas | Cosmético | Son el único camino de la orden al cliente y al vehículo, y miden 92x18 y 55x18 (enlaces dentro del texto: WCAG los exceptúa, pero en tablet cuestan). | `src/app/(app)/service-orders/[id]/page.tsx:183` (`<dd>` con enlace inline) |

## Discarded by inspection

- **Text overlap**: every hit is content behind something on top of it, not a collision —
  the open sidebar sheet over the page, the sticky dialog footer (Guardar/Cancelar) over
  scrolled fields in Nueva orden / Editar orden, and the sticky dialog title over scrolled
  vehicle fields in Editar cliente. Same as the first audit.
- **/template-config low contrast** ("Catálogo: Productos" 1.00, "No hay categorías
  seleccionadas" 3.23, …): text inside the scaled cover preview, drawn over its image and
  template colours. Same false positive as before.
- **/template-config radios 13x13**: each sits inside a whole-tile `<label>` (the card is the hit area).
- **"Toggle Sidebar" 16x1024 at 768**: the `SidebarRail` now renders inside the off-canvas
  sheet (`sidebar.tsx:292`, `hidden sm:flex`). It is an invisible strip at the sheet edge that
  closes the sheet, which tapping the overlay does anyway. Not a defect for the operator.

## Method

Same as `audit.md`. Per screen: `innerWidth` and `scrollWidth`; interactive elements past the
right edge or clipped by a scrolling ancestor; text boxes intersecting; every action control
under 44x44 on touch, **inputs and selects included this time** (checkbox measured by its
`::after` box); text contrast, foreground composited over the first opaque ancestor ground,
resolved through a canvas so `oklch()`/`oklab()` tokens become sRGB, flagged under 4.5:1 (3:1
large), disabled and opacity-faded text skipped, gradient/image grounds discarded; checkbox
border against its ground, flagged under 3:1; tables wider than their box or the viewport;
headings by rendered line count. A second pass took targeted measurements per original
finding (badge ratios, pagination, refusal pages, 768 layouts). #21 and #22 were verified in
code only — reproducing them needs a save or a generate. The "N" bubble in screenshots is the
Next.js dev indicator.
