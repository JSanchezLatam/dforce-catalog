# Responsive Layout Specification

## Purpose

Cross-cutting phone/tablet rules: no horizontal overflow, shared page header, shared no-permission screen, 44px touch floor, text contrast. Proof tags: **[unit]** = component/unit test; **[LAN]** = only the browser check at `http://<LAN-ip>:3000` (jsdom cannot see layout or contrast).

## Requirements

### Requirement: No Horizontal Overflow at 390px

Every audited screen (customers, customer/vehicle detail, service orders and detail, inventory and detail, catalogs, vencimientos, account, users, workshop-config, and the nueva/editar orden and cliente dialogs) MUST have `scrollWidth <= innerWidth` at 390px, both roles, both themes.

#### Scenario: Audited screens fit
- GIVEN any audited screen at 390px
- WHEN it renders with real data
- THEN `document.scrollingElement.scrollWidth` MUST NOT exceed the viewport and no action control MUST be clipped off-screen. **[LAN]**

### Requirement: Shared Page Header

Pages MUST render title and actions through one shared header: title on one line at phone size (`text-2xl`, 32px from `sm`), actions wrapping below the title, page padding `p-4` on phones and `p-8` from `sm`.

#### Scenario: Title and actions on a phone
- GIVEN `/service-orders` at 390px
- WHEN it renders
- THEN "Órdenes de servicio" MUST occupy one line and "Nueva orden de servicio" MUST be fully visible, 44px tall. **[LAN]**

#### Scenario: Header contract
- GIVEN the shared header with a title and two actions
- WHEN rendered
- THEN the title MUST be an `h1`, actions MUST be in a wrapping container, and the optional subtitle MUST render only when given. **[unit]**

### Requirement: Shared No-Permission Screen

Every page refusing a role MUST render one shared screen: the page title, the heading "No tenés permiso para ver esta página", the text "Pedile acceso a un administrador.", and a "Volver al inicio" link to `/`, at least 44px tall.

#### Scenario: Técnico opens a refused page
- GIVEN a técnico on `/vencimientos`, `/users`, `/workshop-config`, `/builder` or `/template-config`
- WHEN the page renders
- THEN all three strings MUST appear and "Volver al inicio" MUST link to `/`. **[unit]**

#### Scenario: Look is identical across pages
- GIVEN any two refused pages
- WHEN rendered
- THEN both MUST use the same component, differing only in title. **[unit]**; appearance **[LAN]**

### Requirement: Inventory Filter Collapse Below Medium

Below `md` (768px), the inventory list's filter panel MUST collapse behind a "Filtros" toggle button. When any filter is active on page load, the panel MUST start open; when no filters are active, it MUST start closed. The button label MUST show "Filtros (n)" when n > 0 filters are active.

#### Scenario: Filters toggle below md
- GIVEN `/inventory` at 390px
- WHEN the page renders
- THEN a "Filtros" button MUST be visible and the filter panel MUST be hidden by default unless a filter is already active

#### Scenario: Active filters show count
- GIVEN a filter already active when the page loads at 390px
- WHEN the page renders
- THEN the button MUST read "Filtros (1)" or higher, and the panel MUST be open

#### Scenario: Filters visible at md+
- GIVEN `/inventory` at 768px and above
- WHEN the page renders
- THEN the filter panel MUST be visible and the toggle button MUST NOT appear

### Requirement: 44x44 Touch Floor

Every action control MUST measure at least 44x44 on touch (`pointer-coarse`), set once in the shared primitives (button, sidebar item, checkbox hit area, pagination, dialog close), not per call site. Desktop (1280) sizing MUST be unchanged.

#### Scenario: Controls meet the floor
- GIVEN touch emulation at 390px
- WHEN measuring buttons, sidebar items, page numbers, dialog close and checkboxes
- THEN each MUST be at least 44x44. **[LAN]**

#### Scenario: Primitives carry the floor
- GIVEN `Button` (default, sm), sidebar item, pagination link, dialog close
- WHEN rendered
- THEN each MUST include the `pointer-coarse` minimum classes. **[unit]**

#### Scenario: Desktop unchanged
- GIVEN 1280px, fine pointer
- WHEN list pages render
- THEN control sizes MUST equal today's. **[LAN]**

### Requirement: Text Contrast in Both Themes

Text MUST reach 4.5:1 (3:1 for large text) in dark AND light for: status chips, success/warning toasts, the destructive button, the inventory initial avatar, success-saved messages and the generate-confirm warning box. Non-text UI (checkbox border) MUST reach 3:1. No text colour MAY be a raw palette class without a counterpart for the other theme.

#### Scenario: Measured contrast
- GIVEN each listed element in dark and light
- WHEN contrast is computed against its background
- THEN it MUST meet its threshold above. **[LAN]**

#### Scenario: Theme-paired colours
- GIVEN the avatar, destructive button, success text and warning box
- WHEN rendered
- THEN none MAY use fixed `text-white`, `text-green-600` or `amber-50` without a `dark:` pair. **[unit]**

### Requirement: Builder and Template Config Stay Tablet-Plus

`/builder` and `/template-config` MUST NOT gain a phone layout; they MUST keep working at 768px with the template cover preview not clipped.

#### Scenario: Unchanged on phones
- GIVEN `/builder` at 390px
- WHEN this change is applied
- THEN its markup MUST be unchanged. **[unit]**

#### Scenario: Tablet preview
- GIVEN `/template-config` at 768px
- WHEN rendered
- THEN the cover preview MUST be fully visible. **[LAN]**
