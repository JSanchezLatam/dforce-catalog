# Delta Spec: workshop-settings (catalog-cover-templates)

`workshop_config` already carries `cover_image_r2_key` and
`cover_image_content_type`, and the worker already inlines them, but the main
spec never described them. This delta documents that existing content; it adds
no column and no behaviour.

## ADDED Requirements

### Requirement: Cover Image Ownership

The catalog cover image (`workshop_config.coverImageR2Key` and
`coverImageContentType`) MUST be workshop-owned content, independent of the
selected template, like the logo and `coverText`. It MAY be unset. Every
template consumes the same image; no per-template cover images exist.

#### Scenario: Cover image survives a template switch

- GIVEN the Administrador has uploaded a cover image
- WHEN they switch the selected template in the gallery
- THEN the stored cover image MUST remain unchanged and MUST be used by the
  newly selected template

#### Scenario: No cover image set

- GIVEN no cover image has been uploaded
- WHEN a catalog is generated with any template
- THEN the catalog MUST render using that template's defined fallback and MUST
  NOT contain a broken image reference
