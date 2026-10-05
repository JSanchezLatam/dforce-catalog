# Mobile audit — every screen at phone width, both accounts, both themes

Measured 2026-10-05 against `main` @ 51ef6c1, dev server at `http://192.168.0.25:3000`
(LAN IP), Playwright Chromium, `isMobile` + touch. Phones at **390x844**; `/builder` and
`/template-config` at **768x1024** (tablet-only by the owner's decision). Matrix:
**administrador (`admin`) and técnico (`Tecnico`) × dark and light** — 86 screenshots in
`admin-dark/`, `admin-light/`, `tecnico-dark/`, `tecnico-light/` (`<slug>-390.png` /
`<slug>-768.png`; `/login` is in the two `admin-*` folders, it has no account). Theme forced
through `localStorage.theme` and checked per page (`<html class="dark">` matched on all 86).
Read-only: no form submitted, only dialog/sidebar openers pressed.

**Result: 2 Bloquea, 8 Molesta, 12 Cosmético (22).** The 15 findings of the first audit
all reproduce, and **13 of them are identical in all four combinations** — the layout does
not depend on role or theme. What is new: **7 findings** — 2 shared colour-contrast problems
the first audit did not measure, 2 that only appear in one theme, 1 that only the técnico
sees, and 2 found in the code that no read-only screen can show. Fix the four shared root
causes and most of the table disappears at once.

Column **Cuenta / Tema**: `todas` = admin and técnico, dark and light.

## Ranked findings

| # | Pantalla | Cuenta / Tema | Severidad | Problema (para el dueño) | Dónde en el código |
|---|---|---|---|---|---|
| 1 | /service-orders (y el diálogo Nueva orden) | todas | **Bloquea** | La página es más ancha que el teléfono (462px en uno de 390): el navegador la achica o hay que arrastrarla de costado, y el botón "Nueva orden de servicio" queda cortado fuera de la pantalla. El título se parte en tres renglones ("Órdenes / de / servicio"). Al abrir "Nueva orden" el formulario aparece pegado a los bordes por el mismo motivo. El técnico también tiene el botón, así que le pasa igual. | `src/app/(app)/service-orders/page.tsx:117-124` — fila `flex items-center justify-between` sin `flex-wrap`; botones `shrink-0` |
| 2 | /customers, /service-orders, /inventory, /users | todas (/users solo admin) | **Bloquea** (en la práctica) | Las tablas miden entre 2 y 3 veces el ancho del teléfono (638-988px dentro de una caja de 302px). La única forma de abrir un cliente/orden/producto es el botón "⋯" de la última columna, 280-550px a la derecha: hay que adivinar que la tabla se desliza de costado. En Órdenes, además, **Estado** y **Cita** quedan escondidos. Al técnico le pasa igual (en Inventario la tabla es un poco más angosta, 681px, porque no tiene casillas). | `src/components/ui/table.tsx:83,96` (`whitespace-nowrap` en cada celda) + columnas: `customers/page.tsx:275-314`, `service-orders/page.tsx:203-221`, `inventory/page.tsx:188`, `modules/account/UsersTable.tsx:269` |
| 3 | Diálogo Editar cliente (vehículos) | todas | Molesta | El selector "Marca" es 30px más ancho que su columna; cuando el formulario llega a esa ficha, todo se corre de costado y las etiquetas quedan mochas ("laca", "lodelo", "hasis", "olor primario"). Igual para el técnico (que sí puede editar clientes). | `src/modules/customers/CustomerForm.tsx:726` (`grid grid-cols-2` sin `min-w-0`) + `src/modules/customers/VehicleMakeModelFields.tsx:100` |
| 4 | /customers/[id], /customers/[id]/vehicles/[id] | todas | Molesta | En el historial de órdenes el botón "Ver" queda 220-280px fuera de la pantalla, detrás del deslizamiento lateral de la tabla. | misma causa que #2: `table.tsx:83,96` |
| 5 | /customers, /inventory | todas | Molesta | La paginación no entra: "Página 1 de 39" se aprieta en tres renglones y se corta ("Pági…"); los números de página miden 28px de alto. | `src/shared/ui/Pagination.tsx:89` (`nav` sin `flex-wrap`), `:101` (`ml-4`) |
| 6 | **NUEVO** — Estados en listas y avisos | todas | Molesta | Las etiquetas de estado tienen letra blanca sobre verde o naranja que se lee mal en los dos temas: "Completada", "Listo" y el aviso verde "Sincronización completada" dan 2.3:1; "En progreso", "En 11 días", "Este mes" dan 3.2:1 (el mínimo legible es 4.5:1). Afecta Órdenes, la ficha de la orden, Inventario, Catálogos y Vencimientos. | `src/shared/ui/StatusBadge.tsx:20-45` + `src/shared/ui/Toast.tsx:12` sobre los tokens `--success`/`--warning` (`src/app/globals.css:98-101`, `:139-142`) |
| 7 | **NUEVO** — Diálogo Editar cliente | admin · **oscuro** (claro también falla, menos) | Molesta | El botón "Eliminar definitivamente" es rojo oscuro sobre fondo oscuro: en modo oscuro casi no se lee (1.8:1, y 1.4:1 en el vehículo desactivado). En claro mide 3.3:1. El técnico no tiene este botón. | `src/components/ui/button.tsx:19` (variante `destructive` usa `text-destructive`); el comentario de `src/components/ui/badge.tsx:16-33` ya lo anotó como pendiente y muestra el arreglo (`text-red-700 dark:text-red-400`) |
| 8 | /inventory | admin · ambos temas | Molesta | El cartel verde de la última sincronización queda cortado por el borde de la tarjeta ("Co…"). El técnico no lo ve porque no tiene el botón "Sincronizar inventario". | `src/modules/inventory-view/InventoryStatsHeader.tsx:43` |
| 9 | Menú lateral (Abrir menú) | todas | Molesta | Cada opción mide 32px de alto (la regla del taller es 44). El técnico ve 4 opciones (Clientes, Órdenes de servicio, Inventario, Catálogos Generados) y el admin 10. | `src/components/ui/sidebar.tsx:487` (`default: "h-8 text-sm"`) |
| 10 | Varias | todas (admin tiene más botones) | Molesta | Botones por debajo de 44x44: "Nueva orden de servicio" 179x32, "Nuevo usuario" 115x32, "Sincronizar inventario" y "Limpiar" 32px, "Guardar"/"Cambiar contraseña" 32px, "Vista previa/Descargar/Imprimir" 32px, "Eliminar"/"Agregar red social" 28px, "Guardar/Cancelar" de Nueva orden y Editar orden 32px, la X de cerrar de todos los diálogos 28x28, casillas de filas 16x16. | `src/components/ui/button.tsx:23-26` (`default` = `h-8`, `sm` = `h-7`); cada llamada sin `min-h-11 min-w-11` |
| 11 | Todas las páginas con título | todas | Cosmético | Títulos de 32px que se parten en dos o tres renglones: "Vencimientos / próximos", "Gestión de / usuarios", "Configuración del / CRM" (también en la pantalla de "sin permiso" del técnico), "Órdenes / de / servicio". | `src/shared/ui/styles.ts:6` (`PAGE_HEADING`, `text-[32px]` fijo) |
| 12 | Todas | todas | Cosmético | Margen de 32px a cada lado en todas las páginas: se pierden 64 de 390px. En Catálogos hay tarjeta dentro de tarjeta y el margen se duplica. | `p-8` en 36 lugares de `src/app/(app)/**/page.tsx`; `src/app/(app)/catalogs/page.tsx:26` |
| 13 | /customers/[id] | todas | Cosmético | El nombre del cliente queda apretado contra "Editar" y "Desactivar" y se parte ("Rosa / Martínez"). | `src/app/(app)/customers/[id]/page.tsx:84` (`CardHeader flex flex-row`) |
| 14 | /inventory | todas | Cosmético | Antes de ver un producto hay que pasar el saludo, la tarjeta de totales, el título y cinco filtros apilados (casi una pantalla). El saludo aparece arriba del título. | `src/app/(app)/inventory/page.tsx:106-118`, `src/modules/inventory-view/InventoryFilters.tsx` |
| 15 | /service-orders/[id] | todas | Cosmético | El título muestra el identificador completo y lo parte por la mitad; el mismo código largo aparece en la miga de pan. | `src/app/(app)/service-orders/[id]/page.tsx:128,136` |
| 16 | /workshop-config | admin · ambos temas | Cosmético | Filas de redes sociales apretadas: el usuario se corta ("D Force Ca…", "@dforcecar…"). El botón de archivo dice "Choose File / No file chosen" (control nativo, en inglés). | `src/modules/workshop-config/WorkshopConfigForm.tsx:271` |
| 17 | /builder, /template-config (768) | admin · ambos temas | Cosmético | A 768px el menú lateral queda fijo y se come un tercio de la pantalla. En Plantillas la vista previa de la portada se ve cortada a la derecha. | `src/components/ui/sidebar.tsx` (corte `md` = 768px); `src/modules/template-config/TemplateConfigForm.tsx:262` |
| 18 | **NUEVO** — Pantallas "sin permiso" | **técnico** · ambos temas | Cosmético | Cuando el técnico entra a Vencimientos, Usuarios, Config. del CRM, Generar catálogos o Plantillas ve solo una frase suelta ("No tenés permiso para ver esta página."), sin explicación ni botón para volver. Encima, cada pantalla es distinta: Usuarios, Config. del CRM y Plantillas muestran el título grande; Vencimientos y Generar catálogos no. | El mensaje está copiado a mano en 16 páginas, p. ej. `src/app/(app)/vencimientos/page.tsx:69`, `builder/page.tsx:46` (sin título) vs `users/page.tsx:23`, `workshop-config/page.tsx:14`, `template-config/page.tsx:29` (con título) |
| 19 | **NUEVO** — /inventory | todas · **solo oscuro** | Cosmético | El círculo con la inicial del usuario ("A" / "T") arriba a la derecha sale blanco sobre blanco en modo oscuro: la letra no se ve (1.04:1). En claro es negro con letra blanca y se ve bien. | `src/modules/inventory-view/InventoryStatsHeader.tsx:35` (`bg-primary` + `text-white` fijo; debería ser `text-primary-foreground`) |
| 20 | **NUEVO** — Casillas de selección (Clientes, Órdenes, Inventario, Usuarios, Nuevo cliente) | todas · **solo claro** | Cosmético | En modo claro el borde de las casillas es gris casi blanco sobre blanco (1.3:1): las casillas apenas se ven. En oscuro tienen relleno y se distinguen. | `src/components/ui/checkbox.tsx:13` (`border-input`; `--input` claro = `hsl(240 5.9% 90%)`, `globals.css:103`) |
| 21 | **NUEVO** (solo por código) — Mensajes "guardado" en Cuenta, Config. del CRM, Plantillas, Generar catálogo | admin y técnico · **solo claro** | Cosmético | Los avisos verdes "Contraseña actualizada." y similares usan un verde fijo que sobre blanco da 3.3:1. No se vio en pantalla porque aparece solo después de guardar. | `text-green-600` sin variante: `src/modules/account/PasswordForm.tsx:105`, `ProfileForm.tsx:71`, `src/modules/workshop-config/WorkshopConfigForm.tsx:321`, `src/modules/template-config/TemplateConfigForm.tsx:252`, `src/modules/catalog-builder/CatalogBuilderForm.tsx:965-966` |
| 22 | **NUEVO** (solo por código) — Confirmar generación de catálogo | admin · **solo oscuro** | Cosmético | El recuadro de advertencia es amarillo claro fijo: en modo oscuro aparece como un parche brillante dentro del diálogo oscuro. No se abrió porque está detrás del botón de generar. | `src/modules/catalog-builder/ConfirmGenerateDialog.tsx:44` (`border-amber-200 bg-amber-50 text-amber-800` sin `dark:`) |

## Shared vs specific

- **Identical in all four combinations (13):** #1-#6, #9-#15. Role and theme change nothing
  in the layout; every layout defect is shared.
- **Admin only (5):** #7 (button the técnico lacks), #8 (sync button the técnico lacks), #16,
  #17, #22 (pages the técnico cannot open).
- **Técnico only (1):** #18, the refusal screens.
- **Dark only (2):** #19 avatar, #22 amber box. #7 is worst in dark.
- **Light only (2):** #20 checkbox borders, #21 green success text.

## Shared root causes — attack these first

1. **Data tables have no phone layout** (`src/components/ui/table.tsx:83,96`). Every cell is
   `whitespace-nowrap`, every list keeps all desktop columns, and the only row affordance is
   the trailing `RowActions` menu. Fixes #2 and #4 for both roles. `/vencimientos`
   (card per row) is the in-repo model.
2. **Page headers are hand-rolled per page** with a fixed 32px `PAGE_HEADING`
   (`src/shared/ui/styles.ts:6`) and `p-8` repeated 36 times. One shared header (title +
   actions, `flex-wrap`, responsive title, `p-4 sm:p-8`) fixes #1, #11, #12, #14 — and, if
   the refusal message becomes a shared component next to it, #18 too (it is the same
   `p-8` + sentence copied into 16 pages).
3. **The 44px floor is applied per call site** (`button.tsx` default `h-8`, sidebar `h-8`,
   pagination 28px, dialog close 28px, checkbox 16px). #5, #9, #10 are one rule missed in
   ~15 places; a touch-size variant or a `pointer-coarse:` minimum on the base variants
   covers them at once.
4. **Colour taken from a token that was not designed for that role, or from a raw palette
   class with no counterpart in the other theme.** `--success`/`--warning` were tuned as
   backgrounds and fail with white text in both themes (#6); `--destructive` in dark is a
   background maroon used as text (#7, already diagnosed in `badge.tsx:16-33`);
   `text-white` on `bg-primary` assumes primary is dark (#19); `--input` as the only
   checkbox border is too pale on white (#20); `text-green-600` / `amber-50` have no `dark:`
   pair (#21, #22). The badge fix in `badge.tsx` is the pattern to copy.
5. **Card/flex rows with no small-screen variant** (#3, #8, #13, #16, `Pagination.tsx:89`):
   `flex-col sm:flex-row` / `flex-wrap` / `min-w-0` on grid children.
   `service-orders/[id]/page.tsx:134` already does it right.

## What the técnico sees

- **Menu:** Clientes, Órdenes de servicio, Inventario, Catálogos Generados (no Vencimientos,
  Generar Catálogos, configuración or usuarios). The menu has no empty gaps.
- **Same as admin:** /customers (incl. "Nuevo cliente", bulk checkboxes), customer and
  vehicle detail, /service-orders (incl. "Nueva orden"), order detail (incl. "Editar orden",
  "Marcar como…"), /inventory/[id], /catalogs, /account, and the Nueva orden / Nuevo cliente /
  Editar orden / Editar cliente dialogs.
- **Less than admin, cleanly:** /inventory has no "Sincronizar inventario" and no row
  checkboxes — the stats card simply shrinks, no awkward gap (and no #8). Editar cliente has
  no "Eliminar definitivamente".
- **Refused** (#18): /vencimientos, /users, /workshop-config, /builder, /template-config.
  No redirect; the page renders the sentence inside the normal shell.

## Already fine at 390 (all four combinations)

- **/login** — fits in both themes. The salmon "Iniciar sesión" in light is the disabled
  state (empty form), not a contrast defect.
- **/vencimientos** (admin) — card per row, 44px "Contactar"; "Vencido" badge reads well.
- **/inventory/[id]** — clean.
- **/service-orders/[id]** — header stacks, photos and actions fit; only #6, #15.
- **/account**, **/catalogs** — layout fits; only #10, #12. The white title on the coloured
  catalog cover is readable (the gradient is the background).
- **Nuevo cliente** dialog — fits, 44px Guardar/Cancelar.
- **Sidebar** in light — readable, items only too short (#9).

## Method notes

- Metrics per screen: `innerWidth` and `scrollWidth` (with `isMobile` Chrome widens
  `innerWidth` past 390 instead of scrolling — that is how #1 shows: 462); interactive
  elements past the right edge or clipped by an `overflow` ancestor; text boxes
  intersecting; action controls under 44x44 (text inputs excluded); tables wider than their
  box; headings by rendered line count.
- **Contrast** (new): every visible text node, foreground blended over the first opaque
  ancestor background, computed through a canvas so `oklch()`/`hsl()` tokens resolve; flagged
  under 4.5:1 (3:1 for large text), disabled controls skipped. False positives discarded by
  eye: text over gradients/images (catalog covers, template preview).
- Text-overlap hits were all the sticky dialog footer over scrolled content and the transient
  sync toast — no label/value collisions.
- The round "N" in the bottom-left of every screenshot is the Next.js dev indicator, absent
  in production.
- #21 and #22 are code-only: reproducing them needs a save or a generate, which this audit
  does not press.

Screenshots (86 PNGs, 4 folders by account × theme) are not committed — `audit.pdf` contains them all.
