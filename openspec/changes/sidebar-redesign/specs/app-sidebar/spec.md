# Delta for app-sidebar

New capability: the application sidebar (`src/components/app-sidebar.tsx`) inside the `(app)` shell. The visual contract is `openspec/changes/sidebar-redesign/mockup/index.html` (approved 2026-10-28). Nav content and permissions stay as `getNavGroups` builds them, and this capability does not change them. UI strings are Spanish exactly as quoted. Tags: **[unit]** jsdom or node test; **[LAN]** only provable in a browser at `http://<LAN-ip>:3000` (jsdom matches no media query and cannot see layout, contrast or hydration).

## ADDED Requirements

### Requirement: Floating Panel Shell

From `lg` (1024px), the sidebar and the content MUST render as two separate rounded panels over a page background, using `variant="inset"`. The page MUST be `--muted` in light and `--background` in dark. The sidebar panel MUST be `--background` in light and `--sidebar` in dark, and the content panel MUST be `--background` in light and `--card` in dark. Both panels MUST have a 16px radius, a border and a shadow. No new color token MAY be introduced. Below `lg`, the sidebar MUST stay an off-canvas sheet, styled as the same floating panel.

#### Scenario: Inset variant
- GIVEN the `(app)` layout
- WHEN it renders
- THEN `Sidebar` MUST carry `data-variant="inset"` and the sidebar inner panel MUST carry the radius, border and shadow classes **[unit]**

#### Scenario: Looks right in both themes
- GIVEN desktop 1440 in light and dark
- WHEN any page renders
- THEN both panels MUST float over the page background as in the mockup, with no new colors **[LAN]**

### Requirement: Active Item

The current entry MUST render as a filled pill (`--sidebar-accent` with semibold text) and carry `aria-current="page"`. Inside a parent, exactly one child MUST be current: the one with the longest `href` that prefixes the pathname. This rule MUST hold in the expanded sidebar and in the rail dropdown alike. In the rail, a parent whose child is current MUST render as a pill.

#### Scenario: Expanded child
- GIVEN the expanded sidebar on `/tablero/clientes`
- WHEN the Tablero parent is open
- THEN only "Pantalla de clientes" MUST be current, and "Pantalla del taller" MUST NOT be **[unit]**

#### Scenario: Rail parent
- GIVEN the rail on `/kanban`
- WHEN it renders
- THEN the Tablero button MUST be active, and the dropdown MUST mark only "Órdenes en curso" **[unit]**

### Requirement: Group Labels

Group labels MUST be small muted text (`--muted-foreground`), with no separator between groups and none above the footer. Groups MUST stay collapsible and persisted in `sidebar_group_state` as today. The chevron MUST be hidden until the label is hovered or has keyboard focus. It MUST always show on a coarse pointer and on a closed group. In the rail, labels MUST NOT render as controls, and a saved closed group MUST NOT hide its icons (today's behavior).

#### Scenario: Chevron reveal classes
- GIVEN an open group label
- WHEN rendered
- THEN its chevron MUST carry the hidden-by-default, `group-hover`, `focus-visible` and `pointer-coarse:` visible classes, and a closed group's chevron MUST be visible without them **[unit]**; appearance **[LAN]**

#### Scenario: No separators
- GIVEN the expanded sidebar
- WHEN rendered
- THEN no `[data-sidebar="separator"]` element MUST be present **[unit]**

### Requirement: Icon Rail Preserved

The collapsed rail MUST keep icon-only entries with tooltips, the Tablero dropdown to the right, and the Vencimientos dot. Its tooltip MUST still read "Vencimientos próximos (N)". The rail MUST add a search icon labelled "Buscar en el menú" with the tooltip "Buscar".

#### Scenario: Rail unchanged
- GIVEN the rail with a Vencimientos badge of 6
- WHEN rendered
- THEN the dot MUST be present and `aria-hidden`, the tooltip MUST name "Vencimientos próximos (6)", and the Tablero dropdown MUST list its three children **[unit]**

### Requirement: User Card

The footer MUST show the user as a bordered card: an avatar, the name, the role label and a chevron. Activating the card MUST open the menu with "Mi cuenta", the theme toggle and "Cerrar sesión", in that order. The menu MUST open above the card in the expanded sidebar and to the right in the rail.

#### Scenario: Menu contents
- GIVEN the expanded sidebar
- WHEN the user card is activated
- THEN the menu MUST list "Mi cuenta", the theme item and "Cerrar sesión" **[unit]**

### Requirement: Sheet Close Button

Below `lg`, the sheet MUST show a "Cerrar menú" button at least 44x44 that closes it. The sheet's accessible title and description MUST be in Spanish.

#### Scenario: Closing the sheet
- GIVEN a viewport below 1024px with the sheet open
- WHEN "Cerrar menú" is activated
- THEN the sheet MUST close **[unit]**, and the button MUST measure at least 44x44 on a tablet and on a phone **[LAN]**

### Requirement: Menu Search

The sidebar MUST show a search box ("Buscar…", accessible name "Buscar en el menú") above the groups. It MUST filter only the `navGroups` it received, so it can never show a link the viewer's permissions removed. Matching MUST be a substring match on the item label, ignoring case and accents ("ordenes" finds "Órdenes"). A matching parent MUST show all its children. A parent with a matching child MUST show only the matching children. A group with no match MUST be hidden. The matched span MUST be highlighted. With no match at all, the list MUST read "Sin resultados para «<query>».". While the query is non-empty, every group and parent MUST render open, and this MUST NOT write `sidebar_group_state`. When the query is cleared, the saved collapse state MUST apply again. With an empty query, the rendered markup MUST equal the unfiltered nav.

#### Scenario: Accent-insensitive match with parent
- GIVEN the nav for an administrador
- WHEN the query is "pantalla"
- THEN Taller MUST show Tablero with "Pantalla del taller" and "Pantalla de clientes" only, and every other group MUST be hidden **[unit]**

#### Scenario: Never reveals a filtered link
- GIVEN the nav built for a técnico
- WHEN the query is "usuarios"
- THEN "Gestión de usuarios" MUST NOT appear, and the empty state MUST show **[unit]**

#### Scenario: Collapsed groups open without persisting
- GIVEN CRM saved as closed
- WHEN the query is "ven"
- THEN "Vencimientos" MUST be visible, and `document.cookie` MUST be unchanged; after `Esc`, CRM MUST be closed again **[unit]**

### Requirement: Search Keyboard

`/` MUST focus the search box unless focus is in an `input`, `textarea`, `select` or contenteditable element, or a modifier key is held. In the rail, `/` MUST expand the sidebar and then focus the box. When the sheet is closed, `/` MUST do nothing. `Esc` in the box MUST clear the query. `Enter` in the box MUST navigate to the first visible link in display order and clear the query. The `/` hint MUST NOT render on a coarse pointer.

#### Scenario: Slash while typing elsewhere
- GIVEN focus in a page `input`
- WHEN `/` is pressed
- THEN the character MUST be typed there and the search box MUST NOT take focus **[unit]**

#### Scenario: Enter opens the first result
- GIVEN the nav for an administrador and the query "clien"
- WHEN `Enter` is pressed
- THEN the router MUST push "/tablero/clientes" (Pantalla de clientes precedes Clientes in display order) **[unit]**

### Requirement: Search in the Rail

In the rail, activating the search icon MUST expand the sidebar and focus the search box.

#### Scenario: Rail icon
- GIVEN the collapsed rail
- WHEN "Buscar en el menú" is activated
- THEN the sidebar state MUST be expanded and the search box MUST have focus **[unit]**

### Requirement: Insecure Context and Hydration Safety

The sidebar MUST NOT use a secure-context-only API (the app is served over plain HTTP on the LAN). Nothing that reads `matchMedia`, the keyboard or the query MAY change the server-rendered markup. Coarse-pointer differences MUST come from CSS `pointer-coarse:` variants only.

#### Scenario: Clean console at the LAN IP
- GIVEN `http://192.168.0.7:3000` from a second machine
- WHEN any page loads at 390, 820 and 1440
- THEN the console MUST show no hydration warning and no `TypeError` **[LAN]**
