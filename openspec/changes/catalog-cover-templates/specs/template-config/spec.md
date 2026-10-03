# Delta Spec: template-config (catalog-cover-templates)

> Visual source of truth: `mockup/cover-and-back.html` (owner-approved 2026-10-03).

## MODIFIED Requirements

### Requirement: Template Gallery Selection (R8.1)

The Template_Engine SHALL let the Administrator select one catalog template
from a fixed, code-defined gallery. The Template_Engine MUST NOT expose
per-config or per-generation controls for logo, primary colors, or
typography — those are fixed properties of the chosen template. Logo and
cover-page text remain configurable, but as workshop-owned content (see
`workshop-settings`), never as template properties. A template MAY define its
own cover and back-page layout; layout is part of the template's fixed form,
never an Administrator-editable control.

#### Scenario: Gallery replaces the style editor

- GIVEN an Administrador opens "Configuración del Template"
- WHEN the page renders
- THEN it MUST show a gallery of available templates and MUST NOT show any
  color, font, logo, or cover-text input

#### Scenario: Selecting a template

- GIVEN the gallery shows more than one official template
- WHEN the Administrador selects one and saves
- THEN the system MUST persist that template's id and use its fixed
  branding and layout for every catalog generated from that point on

#### Scenario: Multi-entry gallery

- GIVEN the registry defines "Dforce Clásico" and "Portada completa"
- WHEN the gallery renders
- THEN it MUST show exactly those two entries, each selectable by name, with
  "Dforce Clásico" pre-selected when no selection has been saved

## ADDED Requirements

### Requirement: Per-Template Cover and Back Layout

A template MAY supply its own cover layout and its own back (contact) page
layout. A template that supplies neither MUST render the classic cover and
contact page exactly as before. The template defines FORM; the content (photo,
logo, cover text, contact data, catalog title) is workshop- or catalog-owned
and supplied identically to every template. "Portada completa" keeps
Clásico's interior pages, colors and font, and uses Saira Condensed and Saira
on its cover and back page only; those fonts MUST render without network
access.

#### Scenario: Clásico is unchanged

- GIVEN "Dforce Clásico" is selected
- WHEN a catalog renders with any combination of photo, logo, cover text and
  contact data
- THEN its cover and contact page MUST render as they did before this change

#### Scenario: Portada completa cover

- GIVEN "Portada completa" is selected and a cover image is uploaded
- WHEN the cover renders in the preview and in the generated PDF
- THEN the photo MUST fill the Letter page under a gradient that darkens to
  near-black at the top, the logo MUST sit top-left with no plate and read as
  solid, and the title block (red rule, "Catálogo:" lead, title, divider,
  workshop name and cover text) MUST sit at the bottom

#### Scenario: Portada completa back page

- GIVEN "Portada completa" is selected and the workshop has contact content
- WHEN the catalog renders
- THEN the last page MUST show the photo strip fading to black, the centered
  logo, a "Contacto" heading with a red rule, one row per set contact field
  with an icon, the social handles, and a red footer band reading "Precios
  sujetos a cambio sin previo aviso"

#### Scenario: No contact content on Portada completa

- GIVEN "Portada completa" is selected and every contact field and social
  handle is empty
- WHEN the catalog renders
- THEN no back page MUST be produced

#### Scenario: Fonts render offline

- GIVEN the server has no internet access
- WHEN a "Portada completa" PDF is generated
- THEN its cover and back page MUST use Saira Condensed and Saira

#### Scenario: Switching template keeps the content

- GIVEN a cover image, logo, cover text and contact data are saved
- WHEN the Administrador switches between the two templates
- THEN that content MUST remain unchanged; only the layout changes

### Requirement: Layout Fallback Without a Usable Photo or Logo

A layout MUST NOT render a broken image. Without a cover image, "Portada
completa" MUST render a solid near-black cover and back page with the logo and
title still present. Without a logo, no logo image or plate is rendered. A
low-resolution photo MUST still fill the page without layout breakage.

#### Scenario: No cover image

- GIVEN "Portada completa" is selected and no cover image is uploaded
- WHEN the cover and back page render
- THEN they MUST show a solid near-black background, the logo (if set) and the
  title, and MUST NOT contain a broken image or a bundled placeholder photo

#### Scenario: Low-resolution photo

- GIVEN a cover image smaller than print resolution (e.g. 736x981)
- WHEN "Portada completa" renders
- THEN the photo MUST still fill the page and the logo and title MUST remain
  legible
