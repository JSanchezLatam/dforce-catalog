# Template Config Specification

## Purpose

Governs how catalog PDF/preview visual branding is chosen and persisted.
Branding is a fixed property of a chosen template — a small code-defined
registry, not admin-editable style — and only the selection and the default
image-handling mode persist.

## Built From

Consolidated 2026-08-12 (first read of this capability; see
`openspec/changes/archive/README.md`).

1. `.kiro/specs/dforce-catalog/requirements.md` — Requisito 8 (baseline;
   translated, R8.1 as originally written)
2. `openspec/changes/archive/adaptive-catalog-layouts/specs/template-config/spec.md`
   — added `defaultImageHandling`
3. `openspec/changes/catalog-templates-and-workshop-info/specs/template-config/spec.md`
   — supersedes R8.1, narrows R8.4, removes per-generation branding

Next reader: this is the FULL current state after applying all three in
order — no further two-source read is needed for `template-config`.

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

### Requirement: Template Config Application (R8.2)

WHEN the Administrador saves a new template selection, THE Template_Engine
SHALL apply it to every catalog generated from that point forward.

#### Scenario: New selection applies going forward

- GIVEN the Administrador switches the selected template and saves
- WHEN the next catalog is generated
- THEN it MUST use the newly selected template's fixed branding

### Requirement: Template Preview Before Save (R8.3)

The gallery MUST show each template's visual preview so the Administrador
can compare options before confirming a selection.

#### Scenario: Preview before confirming

- GIVEN the gallery renders
- WHEN the Administrador views an entry
- THEN it MUST display a preview of that template's fixed look (logo
  placement, colors, typography) before the selection is saved

### Requirement: Template Selection Persistence (R8.4)

The Template_Engine SHALL persist the selected template id in
`template_config` so server restarts do not lose the Administrador's
choice. WHEN the persisted id no longer matches a template in the registry,
THE Template_Engine SHALL fall back to the one official default template
rather than error.

#### Scenario: Selection survives a restart

- GIVEN a saved `selectedTemplateId`
- WHEN the server restarts
- THEN the gallery MUST reopen with that same template shown as selected

#### Scenario: Orphaned id falls back

- GIVEN `template_config.selectedTemplateId` no longer matches any registry
  entry
- WHEN the system resolves branding for a generation
- THEN it MUST use the default official template, not error or crash

### Requirement: Default Image Handling Toggle (R15)

The Administrador MUST be able to switch `template_config.defaultImageHandling`
between `"strict"` and `"adaptive"` via the config UI. `"strict"` forces
every product to `OpaqueProductCard` regardless of `image_type`; `"adaptive"`
selects the card component per product's classified `image_type`. The
setting is applied at generation time, not retroactively.

#### Scenario: Strict forces one card type

- GIVEN `defaultImageHandling = "strict"`
- WHEN a catalog is generated
- THEN all products MUST use `OpaqueProductCard`, even `imageType = "transparent"` ones

#### Scenario: Adaptive matches classification

- GIVEN `defaultImageHandling = "adaptive"`
- WHEN a catalog is generated
- THEN each product MUST use the card component matching its `imageType`

#### Scenario: Existing catalogs unaffected by a later change

- GIVEN a catalog already generated under `"adaptive"`
- WHEN the Administrador later switches to `"strict"`
- THEN that existing catalog MUST NOT be re-rendered
