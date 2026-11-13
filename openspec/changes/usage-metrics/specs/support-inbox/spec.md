# Delta for support-inbox

The support area gains a second section and its own palette. Copy and colors from `mockup/index.html` (palette Opción B), verbatim. Tags as in `usage-metrics`.

## ADDED Requirements

### Requirement: Support Navigation

Every support page behind the login MUST show the tabs "Comentarios" (with the count of Nuevo comments when above zero) and "Uso", with the current one marked `aria-current="page"`. Each tab MUST be a 44×44 minimum target on touch.

#### Scenario: Current tab
- GIVEN the developer is on `/support/uso`
- WHEN the page renders
- THEN "Uso" MUST carry `aria-current="page"` and "Comentarios" MUST NOT **[unit]**

### Requirement: Support-Only Palette

The support area (login, inbox, detail, usage) MUST use palette Opción B: dominant `#121417`, secondary `#D9DCE1`, accent the workshop red `hsl(0 72% 51%)`. The red MUST NOT be the color of text smaller than 18.66px bold; it MAY fill controls whose text is white. The customer pages under `/c` MUST keep their current colors. The support area is dark-only (assumption recorded in the proposal).

#### Scenario: Customer pages unchanged
- GIVEN the palette is applied
- WHEN `/c` renders
- THEN none of the support palette's tokens MUST apply to it **[unit]**

#### Scenario: Support pages use the palette in either OS theme
- GIVEN the OS prefers light or dark
- WHEN a support page renders
- THEN it MUST render with the Opción B tokens **[browser]**
