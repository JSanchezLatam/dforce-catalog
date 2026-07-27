# Delta Spec: catalog-generation (crm-shell-settings-rbac)

Additive to the existing delta at `openspec/changes/adaptive-catalog-layouts/specs/catalog-generation/spec.md` (image handling). No prior requirement there covers access control, so this is ADDED, not MODIFIED.

## ADDED Requirements

### Requirement: Catalog Generation Restricted to Administrador

`POST /api/catalog-builder/generate` MUST be gated on the `catalogs.generate` action, which is `false` for `tecnico` and `true` for `administrador` (see `role-permissions`). This is a breaking reduction from today's behavior, where any authenticated user can generate.

#### Scenario: Técnico denied generation

- GIVEN a `tecnico` with a valid session
- WHEN they call `POST /api/catalog-builder/generate`
- THEN the system MUST return `403` and MUST NOT enqueue any generation job

#### Scenario: Administrador unaffected

- GIVEN an `administrador` with a valid session
- WHEN they call `POST /api/catalog-builder/generate`
- THEN the request MUST behave exactly as it does today (job enqueues normally)

#### Scenario: Nav item absent for Técnico

- GIVEN a `tecnico` user
- WHEN the sidebar renders
- THEN "Generar Catálogos" MUST be absent (see `app-navigation`)

### Requirement: Técnico's Pre-Existing Catalogs Remain Listable

Restricting `catalogs.generate` MUST NOT affect `catalogs.read`/`catalogs.download` or ownership logic. A `tecnico`'s catalogs generated before this change (or generated on their behalf) MUST remain listable and downloadable exactly as today — ownership/listing logic is untouched by this change.

#### Scenario: Pre-existing catalog still listed

- GIVEN a `tecnico` who generated catalogs before this change shipped
- WHEN they open "Catálogos Generados"
- THEN their existing catalogs MUST still appear in the list, unchanged
