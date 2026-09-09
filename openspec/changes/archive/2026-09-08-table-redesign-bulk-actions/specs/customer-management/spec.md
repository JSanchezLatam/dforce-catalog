# Delta for customer-management

## ADDED Requirements

### Requirement: Bulk Activate/Deactivate From the List

Staff MUST be able to select customers in the list view (per
`table-bulk-actions`) and apply Activar or Desactivar to the whole selection.
The bulk action MUST loop the existing per-row `deactivateCliente`/
`reactivateCliente` path (`PATCH /api/customers/[id]` with `{active}`)
sequentially, one row at a time — never a batched `UPDATE`. Applying
"Desactivar" to a selection that mixes already-deactivated rows MUST leave
those rows as a no-op success, not a reported failure; the mixed-state
ambiguity that requires two separate action buttons is specific to
`user-management`'s admin-floor rule and does not apply here.

#### Scenario: Bulk deactivate applies to every selected active customer
- GIVEN 8 selected customers, all active
- WHEN staff runs "Desactivar"
- THEN the system MUST deactivate all 8 through 8 sequential calls to the existing per-row endpoint, and report 8 successes

#### Scenario: Already-deactivated rows are a silent success, not a failure
- GIVEN a selection of 5 customers where 2 are already deactivated
- WHEN staff runs "Desactivar"
- THEN the system MUST report all 5 as applied, without listing the 2 as failures

#### Scenario: Partial success on invalid rows
- GIVEN a selection that includes a customer id since deleted by another session
- WHEN staff runs the bulk action
- THEN the system MUST apply it to every valid row and report the missing customer by id with a "no longer exists" reason, without failing the whole batch
