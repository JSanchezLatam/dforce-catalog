# Spec: workshop-settings (crm-shell-settings-rbac)

## Purpose

Single-workshop singleton config ("Config. del CRM") feeding the sidebar header. v1 = workshop `name` + `logo` only. No tenancy. Business hours and information sources are deliberately OUT of scope for this spec — no requirement below covers them, and no UI for them ships in v1.

## Requirements

### Requirement: Singleton Workshop Config

The system MUST persist exactly one workshop config row (no per-workshop history). Fields in v1 are `name` (text) and `logo` (uploaded file) only; both MAY be unset independently.

#### Scenario: No config saved yet

- GIVEN no workshop config row exists
- WHEN an Administrador opens "Config. del CRM"
- THEN the form MUST show an empty name field and no logo, with no error

#### Scenario: Partial save — name only

- GIVEN no logo has been uploaded
- WHEN an Administrador submits only a name
- THEN the system MUST persist the name and leave the logo unset

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

### Requirement: Independence from Template Config Logo

The workshop logo MUST be stored and read independently of `template_config.logoUrl` (catalog PDF branding). Changing one MUST NOT affect the other.

#### Scenario: Workshop logo does not affect PDF branding

- GIVEN an Administrador sets a new workshop logo
- WHEN a catalog PDF is generated
- THEN the PDF MUST continue using `template_config.logoUrl`, unaffected by the workshop logo change

#### Scenario: Template logo does not affect sidebar

- GIVEN `template_config.logoUrl` is changed
- WHEN the sidebar header next renders
- THEN the workshop logo MUST remain unchanged
