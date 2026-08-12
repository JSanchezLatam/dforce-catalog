# Spec: template-config

Template branding and gallery selection. The template is a fixed, code-defined visual form; the workshop is the content owner.

## Requirements

### Requirement: Template Gallery Selection (R8.1)

The Template_Engine SHALL let the Administrator select one catalog template
from a fixed, code-defined gallery. The Template_Engine MUST NOT expose
per-config or per-generation controls for logo, primary colors, or
typography — those are fixed properties of the chosen template. Logo and
cover-page text remain configurable, but as workshop-owned content (see
`workshop-settings`), never as template properties.

#### Scenario: Gallery replaces the style editor

- GIVEN an Administrador opens "Configuración del Template"
- WHEN the page renders
- THEN it MUST show a gallery of available templates and MUST NOT show any
  color, font, logo, or cover-text input

#### Scenario: Selecting a template

- GIVEN the gallery shows the one official template
- WHEN the Administrador selects it and saves
- THEN the system MUST persist that template's id and use its fixed
  branding for every catalog generated from that point on

#### Scenario: Single-entry gallery

- GIVEN the registry currently defines exactly one official template
- WHEN the gallery renders
- THEN it MUST show exactly that one entry, pre-selected as the default

### Requirement: Template Selection Persistence (R8.4)

The Template_Engine SHALL persist the selected template id (not colors,
font, logo, or cover text) in `template_config` so that server restarts do
not lose the Administrator's choice. When the persisted id is unknown or
missing (e.g. after a deploy removed a template), the read path falls back
to the default without error; the write path rejects an unknown id with HTTP
400. This asymmetry preserves reading when a template is orphaned while
preventing writes that could corrupt branding.

#### Scenario: Selection survives a restart (read path)

- GIVEN a saved `selectedTemplateId`
- WHEN the server restarts and a catalog is generated
- THEN the system MUST use that template's branding for the catalog

#### Scenario: Orphaned id falls back (read path)

- GIVEN `template_config.selectedTemplateId` no longer matches any registry
  entry
- WHEN the system resolves branding for a generation
- THEN it MUST use the default official template, not error or crash

#### Scenario: Unknown id rejected (write path)

- GIVEN an Administrador attempts to save a `selectedTemplateId` not in the registry
- WHEN the request reaches `POST /api/template-config`
- THEN the system MUST return HTTP 400 with a validation error
