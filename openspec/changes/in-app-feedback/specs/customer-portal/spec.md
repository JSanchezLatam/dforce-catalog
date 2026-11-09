# Delta for customer-portal

Only the ingest whitelist changes. Authentication (HMAC, 5-minute window, 401) and every customer-ingest behavior are unchanged. Tags: **[unit]** node test; **[e2e]** needs a real Postgres.

## MODIFIED Requirements

### Requirement: Ingest Payload Is Validated Against the Whitelist

The ingest endpoint MUST validate the body against the strict wire contract (the single dependency-free contract file shared with the workshop) and MUST reject with 400, writing nothing, a body that carries any field outside the whitelist, a missing required field, a body whose kind is not one of the whitelisted kinds, or, for a customer body, a status other than the four allowed labels. The whitelisted body kinds are the existing customer kinds defined in `portal-sync` (upsert and delete) and one new kind, `feedback`. A `feedback` body MUST carry exactly these fields and no others: `id` (UUID), `username`, `role` (one of `tecnico`, `jefe_taller`, `administrador`), `category` (one of `bug`, `idea`, `other`), `text` (1 to 2000 characters), `route`, `screenLabel` and `createdAt` (ISO timestamp). A `feedback` body MUST NOT carry `receivedAt`, `status` or `note`. The portal MUST NOT store a field it did not validate. Validation MUST be exact at every level, as for the customer kinds, and the contract change MUST keep the existing contract tests green.
(Previously: the whitelist covered only the customer upsert and delete bodies.)

#### Scenario: Unknown field rejected
- GIVEN a signed upsert body carrying an extra `phone` field
- WHEN it is received
- THEN the portal MUST respond 400 and MUST persist nothing **[unit]**

#### Scenario: Feedback accepted
- GIVEN a correctly signed, valid `feedback` body
- WHEN it is received
- THEN the portal MUST respond 2xx and persist one feedback row **[unit]**; real INSERT **[e2e]**

#### Scenario: Feedback with an extra field
- GIVEN a signed `feedback` body carrying `receivedAt`, `status` or any other extra field
- WHEN it is received
- THEN the portal MUST respond 400 and MUST persist nothing **[unit]**

#### Scenario: Feedback with a missing or invalid field
- GIVEN a signed `feedback` body with a missing field, a role outside the three, a category outside the three, empty text, text over 2000 characters, or a non-UUID id
- WHEN it is received
- THEN the portal MUST respond 400 and MUST persist nothing **[unit]**

#### Scenario: Unknown kind
- GIVEN a signed body of an unlisted kind
- WHEN it is received
- THEN the portal MUST respond 400 and MUST persist nothing **[unit]**

#### Scenario: Customer ingest unchanged
- GIVEN the existing customer upsert and delete bodies and tests
- WHEN the change is applied
- THEN they MUST behave and pass exactly as before **[unit]**

#### Scenario: Unsigned feedback
- GIVEN a valid `feedback` body with no or a wrong signature
- WHEN it is received
- THEN the portal MUST respond 401 and persist nothing **[unit]**

## ADDED Requirements

### Requirement: Feedback Insert Is Idempotent by Server Id

The portal MUST insert a feedback row keyed by the body's `id` and MUST treat a second delivery of the same `id` as a success that changes nothing (`ON CONFLICT (id) DO NOTHING`, answering 2xx), so that a retried or replayed send creates no second row and the sender stops retrying. A duplicate MUST NOT overwrite the first row's content, `received_at`, status or note, even when the duplicate's fields differ.

#### Scenario: Duplicate send
- GIVEN a feedback row already stored for an `id`
- WHEN a validly signed body with the same `id` arrives
- THEN the portal MUST respond 2xx and the table MUST still hold exactly one row for that `id` **[unit]**; real constraint **[e2e]**

#### Scenario: Duplicate does not overwrite
- GIVEN a stored row marked Resuelto with a note
- WHEN a duplicate with different text arrives
- THEN text, status, note and `received_at` MUST be unchanged **[unit]**; **[e2e]**

#### Scenario: Concurrent duplicates
- GIVEN two identical signed requests processed at the same time
- WHEN both complete
- THEN exactly one row MUST exist and both MUST answer 2xx **[e2e]**

### Requirement: Portal Stamps received_at

The portal MUST set `received_at` itself, from its own clock, at first insert. It MUST NOT accept `received_at` from the body, and a delivery of the same `id` after the first MUST NOT change it. A new stored feedback row MUST start with status "Nuevo" and an empty internal note.

#### Scenario: Server clock
- GIVEN a `feedback` body with a `createdAt` of yesterday
- WHEN it is stored
- THEN `received_at` MUST equal the portal's current time, not `createdAt` **[unit]**

#### Scenario: Initial state
- GIVEN a newly stored feedback row
- WHEN read
- THEN its status MUST be Nuevo and its note empty **[unit]**

#### Scenario: Queued comment keeps both times
- GIVEN a comment created 3 hours before delivery
- WHEN it is stored
- THEN `created_at` MUST be the workshop's time and `received_at` the portal's, 3 hours later **[unit]**
