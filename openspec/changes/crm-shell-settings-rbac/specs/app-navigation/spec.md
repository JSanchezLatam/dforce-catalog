# Spec: app-navigation (crm-shell-settings-rbac)

## Purpose

Grouped, role-aware sidebar replacing today's flat 6-link list; workshop-branded header; name+role footer. Sidebar stays `collapsible="icon"` — collapsed-state behavior is a first-class requirement, not an afterthought.

## Requirements

### Requirement: Grouped Navigation Structure

The sidebar MUST render three groups in this order: `CRM`, `Catálogo`, and `Configuración`. `Configuración` MUST be pinned at the bottom of the sidebar content, directly above the user footer button, not interleaved with `CRM`/`Catálogo`.

| Group | Item (exact label) | Href |
|---|---|---|
| CRM | Clientes | /customers |
| CRM | Órdenes de servicio | /service-orders |
| CRM | Inventario | /inventory |
| Catálogo | Generar Catálogos | /builder |
| Catálogo | Catálogos Generados | /catalogs |
| Configuración | Config. del CRM | (new workshop-settings route) |
| Configuración | Config. de catálogos | (parent of nested item below) |
| Configuración | Configuración de template (nested) | /template-config |
| Configuración | Gestión de usuarios | (new user-management route) |

"Gestión de usuarios" (admin-only user-management screen, see `user-management` capability) MUST render inside the `Configuración` group, alongside "Config. del CRM" and "Config. de catálogos" (confirmed — no longer an open question).

#### Scenario: Group order and pinning

- GIVEN an Administrador viewing the sidebar
- WHEN it renders
- THEN groups MUST appear in order CRM, Catálogo, Configuración, with Configuración immediately above the user footer

### Requirement: Nested Submenu for Template Configuration

"Configuración de template" MUST render as a nested sub-item under "Config. de catálogos", not as a sibling top-level item.

#### Scenario: Nested item reachable when expanded

- GIVEN the sidebar is expanded
- WHEN an Administrador clicks "Config. de catálogos"
- THEN "Configuración de template" MUST render inline as a nested sub-item beneath it

### Requirement: Per-Role Item Visibility

| Nav item | Técnico de taller | Administrador |
|---|---|---|
| Clientes | visible | visible |
| Órdenes de servicio | visible | visible |
| Inventario | visible | visible |
| Generar Catálogos | **hidden** | visible |
| Catálogos Generados | visible | visible |
| Config. del CRM | hidden | visible |
| Config. de catálogos | hidden | visible |
| Configuración de template | hidden | visible |
| Gestión de usuarios | hidden | visible |

#### Scenario: Gestión de usuarios hidden from Técnico

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN "Gestión de usuarios" MUST be absent from the Configuración group (gated on `users.manage`, see `role-permissions`)

#### Scenario: Técnico's reduced Catálogo group

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN the Catálogo group MUST show only "Catálogos Generados"; "Generar Catálogos" MUST be absent

#### Scenario: Técnico sees no Configuración group

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN the entire Configuración group MUST be absent (zero visible items), not rendered-empty

### Requirement: Collapsed Icon-Mode Behavior

WHEN the sidebar is collapsed to icon-only mode, group text labels (`CRM`, `Catálogo`, `Configuración`) MUST be visually hidden while each item's icon MUST remain visible and reachable via the existing tooltip pattern. The nested "Configuración de template" item MUST remain reachable in collapsed mode without requiring the sidebar to expand (e.g. via a flyout triggered from the parent icon).

#### Scenario: Collapsed group labels

- GIVEN the sidebar is collapsed to icon-only mode
- WHEN a group renders
- THEN its text label MUST be hidden and its items' icons MUST still be visible and clickable

#### Scenario: Collapsed nested submenu stays reachable

- GIVEN the sidebar is collapsed to icon-only mode
- WHEN an Administrador interacts with "Config. de catálogos"
- THEN "Configuración de template" MUST be reachable without first expanding the sidebar

### Requirement: Workshop-Branded Header with Independent Fallbacks

The sidebar header MUST render ONLY the workshop logo and workshop name — the static "Catálogos" subtitle line is REMOVED entirely (settled, no longer an open question). Logo and name MUST fall back independently: an unset logo falls back to the current default icon (`GalleryVerticalEnd`); an unset name falls back to the current default text "Dforce" (single line, not "Dforce / Catálogos").

#### Scenario: Fully configured header

- GIVEN workshop settings has both name and logo set
- WHEN the header renders
- THEN it MUST show the uploaded logo image and the configured name, with no "Catálogos" subtitle anywhere

#### Scenario: Partial config — logo only

- GIVEN workshop settings has a logo but no name
- WHEN the header renders
- THEN it MUST show the uploaded logo AND fall back to "Dforce" for the name slot

#### Scenario: Nothing configured

- GIVEN workshop settings is entirely unset
- WHEN the header renders
- THEN it MUST show the default icon and "Dforce" only — no "Catálogos" subtitle

### Requirement: User Footer Name and Role, with Username Fallback

The footer button MUST show the user's `name` on the first line and a role label ("Administrador" or "Técnico de taller") on the second line. WHEN `name` is empty/null, the first line MUST fall back to `username`.

#### Scenario: Name present

- GIVEN a user with `name = "Ana López"` and `role = "administrador"`
- WHEN the footer renders
- THEN line 1 MUST show "Ana López" and line 2 MUST show "Administrador"

#### Scenario: Name absent, falls back to username

- GIVEN a user with `name = null` and `username = "jperez"`
- WHEN the footer renders
- THEN line 1 MUST show "jperez"
