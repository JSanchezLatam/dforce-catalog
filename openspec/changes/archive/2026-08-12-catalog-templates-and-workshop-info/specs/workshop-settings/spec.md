# Delta Spec: workshop-settings (catalog-templates-and-workshop-info)

Existing full spec: `openspec/changes/archive/crm-shell-settings-rbac/specs/workshop-settings/spec.md`
(single-source — not yet consolidated into `openspec/specs/`, per
`archive/README.md`'s two-source-read policy for this capability).

## ADDED Requirements

### Requirement: Workshop Contact Information

`workshop_config` SHALL gain nullable text columns for `phone`, `whatsapp`,
`email`, `address`, `hours`, and `website`, plus a `socialHandles` JSONB map
for the open-ended platform set (e.g. `{instagram: "@..."}`). The
Administrador MAY set any subset of these fields independently, reusing the
existing partial-field-touch upsert discipline (only fields present in the
request are written).

#### Scenario: Partial update preserves other fields

- GIVEN `workshop_config` already has `email` set
- WHEN the Administrador submits an update containing only `phone`
- THEN the system MUST persist `phone` and leave `email` and every other
  field unchanged

#### Scenario: Hours is one free-text field

- GIVEN the Administrador enters "Lun-Vie 9-18, Sáb 9-13" in the hours field
- WHEN saved
- THEN the system MUST store it verbatim as a single string — no structured
  per-day schedule parsing or validation

#### Scenario: New social platform needs no migration

- GIVEN the Administrador adds a handle for a platform not previously used
- WHEN saved
- THEN the system MUST persist it into `socialHandles` without requiring a
  schema migration

### Requirement: Cover Text Ownership

`coverText` MUST live on `workshop_config`, Administrador-editable
independent of the selected template. The template owns the FORM (layout,
typography, colors, logo placement); the workshop owns the CONTENT (logo
asset, cover text, contact info). Any future question about where a new
piece of catalog data belongs resolves by asking which side of that line it
is on.

#### Scenario: Cover text survives a template switch

- GIVEN the Administrador has set a cover text
- WHEN they switch the selected template in the gallery
- THEN the cover text MUST remain unchanged — only the fixed visual form
  changes

#### Scenario: Cover text applies on next generation

- GIVEN the Administrador edits and saves `coverText`
- WHEN the next catalog is generated
- THEN its cover MUST show the new text

## MODIFIED Requirements

### Requirement: Independence from Template Config Logo

The workshop logo (`workshop_config.logoR2Key`) IS the single source for
both the sidebar header and catalog PDF branding —
`template_config.logoUrl` no longer exists (see `template-config` REMOVED
Requirements). The live builder preview reads the logo through the existing
authenticated `/api/workshop-config/logo` route; the PDF render worker
(which cannot authenticate against that route) MUST resolve `logoR2Key`
through `getObject()` and inline the bytes as a `data:` URI before handing
HTML to Playwright.
(Previously: the workshop logo and `template_config.logoUrl` were two
independent sources; changing one never affected the other.)

#### Scenario: Preview uses the authenticated route

- GIVEN an Administrador uploads a new workshop logo
- WHEN the catalog builder's live preview renders
- THEN it MUST fetch `/api/workshop-config/logo`, unchanged from today's
  sidebar mechanism

#### Scenario: PDF matches the preview exactly

- GIVEN the same workshop logo used above
- WHEN a catalog PDF is generated
- THEN the render worker MUST inline the R2 object bytes as a data URI so
  the rendered cover logo is pixel-identical to the live preview

#### Scenario: No logo set

- GIVEN no logo has been uploaded to `workshop_config`
- WHEN a catalog is generated
- THEN the cover MUST render without a logo, exactly as the sidebar does
  today with no logo set
