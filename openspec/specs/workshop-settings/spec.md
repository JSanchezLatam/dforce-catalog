# Spec: workshop-settings

Workshop configuration: branding assets, contact information, and catalog metadata.

## Requirements

### Requirement: Singleton Workshop Config

The system MUST persist exactly one workshop config row (no per-workshop history, no multi-tenant support). Fields include `name`, `logo`, contact information, cover text, and social handles; all MAY be unset independently.

#### Scenario: No config saved yet

- GIVEN no workshop config row exists
- WHEN an Administrador opens "Config. del CRM"
- THEN the form MUST show empty fields and no logo, with no error

#### Scenario: Partial save — name only

- GIVEN no logo has been uploaded
- WHEN an Administrador submits only a name
- THEN the system MUST persist the name and leave all other fields unset

### Requirement: Logo Upload — Accepted Types and Size Caps

Accepted logo formats are PNG, JPG, WebP, and SVG. Raster formats (PNG/JPG/WebP) MUST NOT exceed 2MB. SVG MUST NOT exceed 512KB.

#### Scenario: Valid raster upload

- GIVEN an Administrador uploads a 1.5MB PNG
- WHEN submitted
- THEN the system MUST accept it and replace any previously stored logo

#### Scenario: Valid SVG upload

- GIVEN an Administrador uploads a 300KB SVG
- WHEN submitted
- THEN the system MUST accept it after sanitization (see SVG Safety requirement)

### Requirement: Logo Upload Validation Failures

The system MUST reject, and MUST NOT alter the currently stored logo, when: the file type is outside {PNG, JPG, WebP, SVG}; a raster file exceeds 2MB; an SVG exceeds 512KB; or the file is corrupt/malformed (unreadable image data or malformed SVG XML).

#### Scenario: Disallowed type

- GIVEN an Administrador uploads a GIF or PDF
- WHEN submitted
- THEN the system MUST reject it with a validation error and keep the existing logo unchanged

#### Scenario: Oversize raster

- GIVEN an Administrador uploads a 3MB JPG
- WHEN submitted
- THEN the system MUST reject it as oversize

#### Scenario: Oversize SVG

- GIVEN an Administrador uploads a 600KB SVG
- WHEN submitted
- THEN the system MUST reject it as oversize

#### Scenario: Corrupt file

- GIVEN an Administrador uploads a file with the correct extension but unreadable/malformed content
- WHEN submitted
- THEN the system MUST reject it with a validation error rather than storing an unusable asset

### Requirement: SVG Safety

Because SVG logos are permitted, the system MUST mitigate script-execution risk through all three of the following, as requirements (not advisory guidance):

1. The stored logo MUST always be rendered via `<img>`/`next/image` in the sidebar header. Uploaded SVG markup MUST NEVER be inlined directly into the DOM.
2. At upload time, the system MUST sanitize SVG content by stripping `<script>` elements, `<foreignObject>` elements, any `on*` event-handler attribute, and any `href`/`xlink:href` referencing a remote (non-data, non-same-asset) URL.
3. WHEN the stored logo object is accessed directly via its public URL, the response MUST include headers that prevent script execution in the application's origin.

#### Scenario: Never inlined

- GIVEN a stored SVG logo
- WHEN the sidebar header renders it
- THEN it MUST be rendered via `<img>`/`next/image`, never as inline SVG markup in the DOM

#### Scenario: Malicious SVG sanitized on upload

- GIVEN an uploaded SVG contains a `<script>` tag, a `<foreignObject>`, an `onload` attribute, or a remote `xlink:href`
- WHEN it is processed at upload time
- THEN the system MUST strip those elements/attributes before storing, and MUST NOT persist the original unsanitized markup

#### Scenario: Direct object access cannot execute script

- GIVEN a stored logo object accessed directly by URL outside the app
- WHEN the response is served
- THEN its headers MUST prevent the browser from treating it as executable content within the app's origin

### Requirement: Workshop Contact Information

`workshop_config` SHALL gain nullable text columns for `phone`, `whatsapp`, `email`, `address`, `hours`, and `website`, plus a `socialHandles` JSONB map for the open-ended platform set (e.g. `{instagram: "@..."}`). The Administrador MAY set any subset of these fields independently, reusing the existing partial-field-touch upsert discipline (only fields present in the request are written).

#### Scenario: Partial update preserves other fields

- GIVEN `workshop_config` already has `email` set
- WHEN the Administrador submits an update containing only `phone`
- THEN the system MUST persist `phone` and leave `email` and every other field unchanged

#### Scenario: Hours is one free-text field

- GIVEN the Administrador enters "Lun-Vie 9-18, Sáb 9-13" in the hours field
- WHEN saved
- THEN the system MUST store it verbatim as a single string — no structured per-day schedule parsing or validation

#### Scenario: New social platform needs no migration

- GIVEN the Administrador adds a handle for a platform not previously used
- WHEN saved
- THEN the system MUST persist it into `socialHandles` without requiring a schema migration

### Requirement: Cover Text Ownership

`coverText` MUST live on `workshop_config`, Administrador-editable independent of the selected template. The template owns the FORM (layout, typography, colors, logo placement); the workshop owns the CONTENT (logo asset, cover text, contact info). Any future question about where a new piece of catalog data belongs resolves by asking which side of that line it is on.

#### Scenario: Cover text survives a template switch

- GIVEN the Administrador has set a cover text
- WHEN they switch the selected template in the gallery
- THEN the cover text MUST remain unchanged — only the fixed visual form changes

#### Scenario: Cover text applies on next generation

- GIVEN the Administrador edits and saves `coverText`
- WHEN the next catalog is generated
- THEN its cover MUST show the new text

### Requirement: Workshop Logo as Single Source for Branding

The workshop logo (`workshop_config.logoR2Key`) IS the single source for both the sidebar header and catalog PDF branding. The live builder preview reads the logo through the existing authenticated `/api/workshop-config/logo` route; the PDF render worker (which cannot authenticate against that route) MUST resolve `logoR2Key` through `getObject()` and inline the bytes as a `data:` URI before handing HTML to Playwright.

#### Scenario: Preview uses the authenticated route

- GIVEN an Administrador uploads a new workshop logo
- WHEN the catalog builder's live preview renders
- THEN it MUST fetch `/api/workshop-config/logo`, unchanged from today's sidebar mechanism

#### Scenario: PDF matches the preview exactly

- GIVEN the same workshop logo used above
- WHEN a catalog PDF is generated
- THEN the render worker MUST inline the R2 object bytes as a data URI so the rendered cover logo is pixel-identical to the live preview

#### Scenario: No logo set

- GIVEN no logo has been uploaded to `workshop_config`
- WHEN a catalog is generated
- THEN the cover MUST render without a logo, exactly as the sidebar does today with no logo set
