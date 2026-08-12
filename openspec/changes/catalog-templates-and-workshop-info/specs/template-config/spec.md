# Delta Spec: template-config (catalog-templates-and-workshop-info)

Supersedes `.kiro/specs/dforce-catalog/requirements.md` Requisito 8.1. R8.4
(persistence across restarts) survives, carried by the stored template id.

## MODIFIED Requirements

### Requirement: Template Gallery Selection (R8.1)

The Template_Engine SHALL let the Administrator select one catalog template
from a fixed, code-defined gallery. The Template_Engine MUST NOT expose
per-config or per-generation controls for logo, primary colors, or
typography — those are fixed properties of the chosen template. Logo and
cover-page text remain configurable, but as workshop-owned content (see
`workshop-settings`), never as template properties.
(Previously: the Administrator configured logo, primary colors, typography,
and cover text directly as fields on `template_config`.)

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
not lose the Administrator's choice. WHEN the persisted id no longer matches
a template in the registry (e.g. after a deploy removed it), THE
Template_Engine SHALL fall back to the one official default template rather
than error.
(Previously: the persisted fields were the full branding object — logo URL,
primary colors, font, and cover text.)

#### Scenario: Selection survives a restart

- GIVEN a saved `selectedTemplateId`
- WHEN the server restarts
- THEN the gallery MUST reopen with that same template shown as selected

#### Scenario: Orphaned id falls back

- GIVEN `template_config.selectedTemplateId` no longer matches any registry
  entry
- WHEN the system resolves branding for a generation
- THEN it MUST use the default official template, not error or crash

## REMOVED Requirements

### Requirement: Per-Generation Font and Color Selection

(Reason: superseded by R8.1 above — typography and primary colors are fixed
per template now, not admin-editable or chosen per generation.)
(Migration: None. The one official template already encodes the mockup's
fonts and colors; no historical config data is lost, only admin-entered
style preferences that this change intentionally retires.)

### Requirement: Template-Owned Logo URL and Cover Text

(Reason: logo and cover text are workshop-owned CONTENT, not template FORM —
see `workshop-settings`' new "Workshop Contact Information" and "Cover Text
Ownership" requirements.)
(Migration: `template_config.logoUrl` is dropped; the PDF worker resolves
`workshop_config.logoR2Key` server-side instead. `template_config.coverText`
moves to `workshop_config.coverText`.)
