# Delta Spec: workshop-settings (catalog-cover-templates)

The owner decided on 2026-10-03 that each template owns its cover image.
Clásico multiplies the photo onto white, so it needs a cut-out product on a
light background. "Portada completa" fills the page and darkens it, so it
needs a dark full-bleed photo. A single shared image always ruins one of the
two covers. This delta records the cover image as the one exception to the
FORM/CONTENT rule. The ADDED "Cover Image Ownership" requirement from an
earlier draft of this change was never archived and has been dropped, so
this delta contains no REMOVED section.

`workshop_config.cover_image_r2_key` and `cover_image_content_type` stay in
the schema, but nothing reads them after migration `0020` copies their value
into Clásico's row (see template-config "Per-Template Cover Image").

## MODIFIED Requirements

### Requirement: Cover Text Ownership

`coverText` MUST live on `workshop_config`, Administrador-editable independent of the selected template. The template owns the FORM (layout, typography, colors, logo placement); the workshop owns the CONTENT (logo asset, cover text, contact info). The cover image is the one exception. It is template-owned and uploaded in "Configuración de template" (see template-config "Per-Template Cover Image"), because a photo composed for one layout ruins another. Any future question about where a new piece of catalog data belongs resolves by asking which side of that line it is on, and whether it depends on the layout the way the cover photo does.

#### Scenario: Cover text survives a template switch

- GIVEN the Administrador has set a cover text
- WHEN they switch the selected template in the gallery
- THEN the cover text MUST remain unchanged — only the fixed visual form changes

#### Scenario: Cover text applies on next generation

- GIVEN the Administrador edits and saves `coverText`
- WHEN the next catalog is generated
- THEN its cover MUST show the new text

#### Scenario: No cover image field in Config. del CRM

- GIVEN an Administrador opens "Config. del CRM"
- WHEN the form renders
- THEN it MUST NOT show a cover image upload field
