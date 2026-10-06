# Delta for table-bulk-actions

Proof tags: **[unit]** component test; **[LAN]** browser check only.

## ADDED Requirements

### Requirement: Phone Card Layout

Below `md`, customers, service orders, inventory and users MUST render one card per record instead of the table; from `md` up the table MUST render unchanged. Both are in the DOM, toggled by CSS. A card MUST show key fields only, and the whole card MUST be one link to the record. Inventory cards MUST show name, code, price and stock ("Sin stock" when 0).

#### Scenario: Cards below md, table at md+
- GIVEN any of the four lists
- WHEN viewed at 390px, then at 768px
- THEN only cards are visible at 390px and only the table at 768px. **[LAN]**; both containers and their `md:hidden` / `hidden md:block` classes **[unit]**

#### Scenario: Tapping a card opens the record
- GIVEN a customer card
- WHEN rendered
- THEN it MUST be a single link to `/customers/<id>`, and the same holds for orders, products, users. **[unit]**

#### Scenario: Order card shows what the table hid
- GIVEN a service order
- WHEN its card renders
- THEN customer, short id, plate, vehicle, status chip and Cita MUST be present. **[unit]**

### Requirement: Selection Is Tablet-Plus Only

Phone cards MUST NOT render checkboxes, and the selection bar MUST NOT be reachable below `md`.

#### Scenario: No selection on phones
- GIVEN the customers list at 390px
- WHEN it renders
- THEN no card contains a checkbox and no selection bar is visible. **[unit]** for card markup; visibility **[LAN]**

## MODIFIED Requirements

### Requirement: Cross-Page Checkbox Selection

Each table MUST offer a checkbox column at `md` and up. Selecting a row MUST add its id to a client-held selection set that survives changing page (or, on `/users`, toggling `Mostrar inactivos`). The selection bar MUST state the total selected count AND make the off-screen portion legible — at minimum, distinguishing how many of the total are on the current page, with a way to view or clear the full set. Selection MUST NOT survive a full page reload or navigating away from the list route.
(Previously: no breakpoint qualifier; checkboxes were always offered.)

#### Scenario: Selection survives paging
- GIVEN 8 customers selected on page 1
- WHEN staff navigates to page 3 and selects 3 more
- THEN the bar MUST report 11 selected total, and returning to page 1 MUST show all 8 still checked

#### Scenario: Off-screen selection is legible, not just counted
- GIVEN 12 selected with only 3 visible on the current page
- WHEN staff reads the selection bar
- THEN it MUST communicate that 9 are selected off-screen, not print "12 seleccionados" with no further affordance

#### Scenario: Selection does not survive a reload
- GIVEN an active selection
- WHEN staff reloads the page or navigates away and back
- THEN the selection MUST be empty
