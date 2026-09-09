# Delta for service-orders

## ADDED Requirements

### Requirement: Bulk Status Change Constrained to Legal Transitions

Staff MUST be able to select service orders in the list view (per
`table-bulk-actions`) and change their status in bulk. The status-change
menu MUST offer only the target statuses that are legal, via
`getAllowedTransitions`, for EVERY row in the current selection — the
intersection of each selected row's legal next states, not the union, and
not every status unconditionally. The bulk action MUST apply
`assertTransition` per row against that row's CURRENT status, looping the
existing single-order transition call sequentially; it MUST NOT read every
row's status once and apply a single batched update.

Because a bulk transition to `done` or `cancelled` is terminal and cannot be
undone through the UI, the confirmation step MUST say so before the action
runs.

#### Scenario: Menu offers only the legal intersection
- GIVEN a selection of 4 orders, 3 `open` and 1 `in_progress`
- WHEN staff opens the bulk status menu
- THEN it MUST offer only `cancelled` — the one status legal from every selected row's current status — and MUST NOT offer `in_progress` or `done`

#### Scenario: Concurrent status drift still fails safely, per row
- GIVEN a selection of 3 `open` orders, one of which another session transitions to `done` before the bulk action runs
- WHEN staff applies "Cancelar" to the original selection
- THEN the system MUST cancel the 2 orders still `open` and report the third by id with the reason its current status no longer allows that transition

#### Scenario: Terminal-status warning shown before applying
- GIVEN a bulk transition targeting `done` or `cancelled`
- WHEN staff confirms the action
- THEN the confirmation copy MUST state that the change cannot be undone through the UI
