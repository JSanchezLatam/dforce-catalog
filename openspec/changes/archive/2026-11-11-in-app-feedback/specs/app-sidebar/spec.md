# Delta for app-sidebar

Copy is from `mockup/index.html` (owner-approved), verbatim. Tags: **[unit]** jsdom or node test; **[LAN]** only provable in a browser at `http://<LAN-ip>:3000`.

## ADDED Requirements

### Requirement: Send Feedback Footer Item

The sidebar footer MUST contain an "Enviar comentario" item (message icon) as its own `SidebarMenuItem`, directly above the user card, visible on every `(app)` screen. It MUST be hidden when the viewer's role lacks the `feedback.send` Action. Activating it MUST open the shared feedback dialog (see `feedback`). On the mobile off-canvas sheet it MUST stay in the footer, visible while the nav list scrolls, and activating it MUST close the sheet and open the dialog. In the collapsed icon rail it MUST show only the icon with the tooltip "Enviar comentario" and an accessible name "Enviar comentario". It MUST NOT change the nav groups, their permissions, the user card or the group persistence.

#### Scenario: Item present above the user card
- GIVEN the expanded sidebar for a técnico
- WHEN it renders
- THEN "Enviar comentario" MUST appear in the footer immediately before the user card **[unit]**

#### Scenario: Opens the dialog
- GIVEN the expanded sidebar
- WHEN "Enviar comentario" is activated
- THEN the feedback dialog MUST open **[unit]**

#### Scenario: Rail tooltip
- GIVEN the collapsed rail
- WHEN rendered
- THEN the item MUST show only the icon, expose the accessible name "Enviar comentario", and show that tooltip on hover or focus **[unit]**

#### Scenario: Mobile sheet closes then dialog stays open
- GIVEN the off-canvas sheet open on a phone
- WHEN "Enviar comentario" is activated
- THEN the sheet MUST close and the dialog MUST remain open, not unmounted with the sheet **[unit]**; real behavior **[LAN]**

#### Scenario: Role without the Action
- GIVEN a role that does not hold `feedback.send`
- WHEN the sidebar renders
- THEN the item MUST be absent **[unit]**

#### Scenario: Hit target
- GIVEN a touch device
- WHEN the footer renders
- THEN the item MUST be at least 44px tall, like the other sidebar rows **[unit]** classes, **[LAN]** measured

#### Scenario: Existing sidebar contracts hold
- GIVEN the existing sidebar scenarios (active item, rail, user card menu, search)
- WHEN the change is applied
- THEN they MUST still pass unchanged **[unit]**
