# Delta for customer-management

Adds the Ley 81/2019 consent record and the portal token lifecycle. Nothing existing is modified: R20 (deactivation) is left as written and the interaction with it is stated as new requirements below.

## ADDED Requirements

### Requirement: Ley 81 Consent Record

The system MUST record a customer's consent to the use of their data in the customer portal as an append-only history. Each row MUST hold the customer, the action (`granted` or `revoked`), the user who recorded it, the time, and the identifier of the clause version the customer was shown. A customer's CURRENT consent MUST be the action of their most recent row; no row means no consent. Revoking MUST append a `revoked` row and MUST NOT update or delete any earlier row. Consent MUST be recorded once per customer, not per order.

The consent clause shown to staff and printed on the sheet is PROVISIONAL until a Panamanian lawyer supplies the final text. Wherever the clause text is displayed, it MUST begin with the banner "Texto provisorio — pendiente de revisión legal". Replacing the text MUST introduce a new clause version identifier and MUST NOT alter the version stored on existing rows. The clause MUST state what the portal shows, that the data is stored by a cloud provider outside Panama, and that the customer can withdraw consent at the workshop.

#### Scenario: Granting records who, when and which version
- GIVEN a customer with no consent rows
- WHEN an authorized user ticks "Consentimiento de datos (Ley 81)" and saves
- THEN one `granted` row MUST exist with that user, the current time and the current clause version, and the customer's current consent MUST be granted

#### Scenario: Revoking appends, never deletes
- GIVEN a customer with a `granted` row
- WHEN consent is revoked
- THEN a `revoked` row MUST be appended, the `granted` row MUST remain unchanged, and the current consent MUST be none

#### Scenario: Re-granting after revocation
- GIVEN a customer whose latest row is `revoked`
- WHEN consent is granted again
- THEN a new `granted` row MUST be appended and the customer MUST have three rows in order

#### Scenario: Saving without touching the checkbox records nothing
- GIVEN a customer with current consent
- WHEN staff edits an unrelated field and saves
- THEN no consent row MUST be appended

#### Scenario: Provisional marker on the clause
- GIVEN the customer detail view showing the clause
- WHEN it renders
- THEN the clause MUST begin with "Texto provisorio — pendiente de revisión legal"

### Requirement: Who Can Record Consent and Rotate the Code

Recording or revoking consent MUST be allowed for `administrador` and `jefe_taller` and MUST be refused with 403 before any database work for any other role. Rotating the portal code MUST be allowed only for `administrador`, and refused with 403 before any database work for every other role, `jefe_taller` included. Both MUST go through `can()` after `requireSession()`, default-deny, like every other customer route. A deactivated customer's consent MUST NOT be changeable while deactivated, consistent with R20.

#### Scenario: Jefe de taller records consent
- GIVEN a `jefe_taller` session
- WHEN they record consent for an active customer
- THEN the system MUST persist the row

#### Scenario: Técnico cannot record consent
- GIVEN a `tecnico` session
- WHEN they attempt to record consent
- THEN the system MUST respond 403 and persist nothing

#### Scenario: Only the administrador rotates
- GIVEN a `jefe_taller` session and an `administrador` session
- WHEN each attempts to rotate a customer's code
- THEN the `jefe_taller` MUST receive 403 with no change and the `administrador` MUST succeed

#### Scenario: Deactivated customer's consent is frozen
- GIVEN a deactivated customer
- WHEN a user attempts to grant or revoke consent
- THEN the system MUST refuse it and append no row

### Requirement: Counter Consent Flow and Refusal

The customer detail view MUST show the consent checkbox labelled "Consentimiento de datos (Ley 81)" with the current state, who recorded it and when. The intended counter flow is: staff ticks consent, prints the sheet carrying the clause, and the customer signs the workshop's copy. A customer who declines to sign MUST be representable by revoking consent: revoking MUST remove the portal token (see Portal Token Lifecycle) so no QR can print. The system MUST NOT treat an unticked checkbox as an error: a customer without consent MUST remain fully usable for orders, printing and every other function.

#### Scenario: Declined at the counter
- GIVEN staff ticked consent and the customer then refuses to sign
- WHEN staff revokes consent
- THEN the customer MUST have no token, no QR MUST print for them, and creating orders for them MUST still work

#### Scenario: State is visible
- GIVEN a customer with current consent recorded by a named user
- WHEN staff opens the detail view
- THEN it MUST show the checkbox ticked with that user's name and the time

### Requirement: Portal Token Lifecycle

When consent is granted the system MUST generate a portal token on the server: at least 256 bits from a cryptographically secure random source, encoded as base64url, and never derived from any id, name, phone or other customer attribute. The workshop MUST store the token (it reprints it) in a column of its own. The token MUST be absent whenever the customer has no current consent. Revoking consent MUST delete the token. Granting consent again MUST generate a NEW token, never restore a revoked one.

The `administrador` MUST be able to rotate the token ("Generar nuevo código"): the system MUST generate a new token replacing the old one in one transaction, and every QR printed with the old token MUST stop working once the sync completes. Rotation MUST be offered only for a customer with current consent, and MUST ask for explicit confirmation stating that already-printed QR codes will stop working.

The token MUST NOT appear in any list, search result, API response other than the print view that renders its QR, log line, or error report.

#### Scenario: Token issued with granting
- GIVEN a customer with no consent
- WHEN consent is granted
- THEN the customer MUST hold a token of at least 43 base64url characters (256 bits) generated server-side

#### Scenario: Two customers never share or derive a token
- GIVEN two customers granted consent in succession
- WHEN their tokens are compared
- THEN the tokens MUST differ and neither MUST be computable from the customer's id

#### Scenario: Revocation deletes the token
- GIVEN a customer holding a token
- WHEN consent is revoked
- THEN the stored token MUST be null

#### Scenario: Re-consent issues a fresh token
- GIVEN a customer who revoked consent and then granted it again
- WHEN the new token is compared with the revoked one
- THEN they MUST differ

#### Scenario: Rotation replaces the token
- GIVEN a customer with a token
- WHEN the administrador confirms "Generar nuevo código"
- THEN the stored token MUST be replaced and the old value MUST NOT remain anywhere in the workshop database

#### Scenario: Rotation needs confirmation
- GIVEN the rotate action
- WHEN the administrador triggers it
- THEN the system MUST NOT rotate until the warning about printed QR codes is confirmed

#### Scenario: Token absent from the customer list
- GIVEN consented customers
- WHEN the list API and list view are called
- THEN no response MUST contain any token

### Requirement: Deactivation Removes the Customer From the Portal

Deactivating a customer MUST cause their portal data to be removed (see `portal-sync`) while PRESERVING their consent history and token, and reactivating them MUST restore portal access with the same token and no re-entry of consent. A deactivated customer MUST NOT have a QR printed (a deactivated customer's QR would open nothing). This adds to R20 without changing it.

#### Scenario: Deactivate keeps the consent record
- GIVEN a consented customer
- WHEN staff deactivates them
- THEN the consent rows and the token MUST be unchanged and a portal removal MUST be enqueued

#### Scenario: Reactivate restores access
- GIVEN a deactivated customer with current consent
- WHEN staff reactivates them and the sync completes
- THEN the same QR printed earlier MUST open the portal again
