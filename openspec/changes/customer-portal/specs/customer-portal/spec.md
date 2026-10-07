# Delta for customer-portal

New capability: the cloud-hosted, phone-first portal where a customer who scanned the QR on their printed copy sees the status and history of their orders. The portal is a separate app (`portal/`) with its own database. The workshop server is never reachable from the internet; the portal only receives pushes (see `portal-sync`).

## ADDED Requirements

### Requirement: Terms Gate Precedes Any Data

The portal MUST show the terms of use before any customer data. Until the visitor presses "Acepto", the response MUST NOT contain a plate, make, model, order id, status, date, finding, or any other customer-derived value — not in the HTML, not in embedded JSON, not in a redirect target. After "Acepto" the portal MUST show the history for that token. Acceptance MUST be recorded server-side per token hash and terms version (no cookie), so a new terms version MUST show the gate again.

The token MUST NEVER be in a URL the server sees. The QR encodes `<PORTAL_BASE_URL>/c#<token>`; the fragment is never sent to a server. `/c` MUST serve a static shell carrying no customer data. A client component MUST read `location.hash`, immediately strip it with `history.replaceState`, and send the token only in the JSON body of `POST /api/c/open` (returns the terms status), `POST /api/c/accept` (records the acceptance and returns the snapshot) and `POST /api/c/snapshot` (returns the snapshot only when the terms are accepted for the current version). The token MUST NOT appear in a query string, cookie, redirect target or log. Every response from these routes MUST carry `Cache-Control: no-store`.

#### Scenario: First visit shows terms only
- GIVEN a valid token whose customer has two vehicles and three orders, with no acceptance recorded for the current terms version
- WHEN the QR is opened
- THEN the page MUST show the terms and an "Acepto" button
- AND neither the shell nor the `open` response MUST contain any of the customer's plates, order ids or order text

#### Scenario: Accepting reveals the history
- GIVEN the terms page for a valid token
- WHEN the visitor presses "Acepto"
- THEN the portal MUST record the acceptance for the current terms version and MUST return and show the customer's history

#### Scenario: Snapshot refused before acceptance
- GIVEN a valid token with no acceptance for the current terms version
- WHEN `POST /api/c/snapshot` is called with it
- THEN the response MUST contain no customer data

#### Scenario: A returning visitor skips the gate
- GIVEN a token with an acceptance recorded for the current terms version
- WHEN its QR is opened again
- THEN the portal MUST show the history directly

#### Scenario: A new terms version re-gates
- GIVEN a token whose only acceptance is for an older terms version
- WHEN its QR is opened
- THEN the portal MUST show the terms again and MUST NOT show any data until "Acepto"

#### Scenario: Token is stripped from the address bar
- GIVEN the QR URL `/c#<token>`
- WHEN the page loads
- THEN the address bar MUST no longer contain the token and no request URL, header or cookie MUST contain it

### Requirement: Terms Acceptance Is Logged

Pressing "Acepto" MUST append a record to the portal's terms-acceptance log holding the SHA-256 hash of the token, the terms version, and the time. The log MUST NOT hold the plaintext token, a customer name, or a phone number. The record MUST be written before the history is returned, and it is the record that decides whether the gate is shown.

#### Scenario: Acceptance logged by token hash
- GIVEN a visitor accepting the terms for a valid token
- WHEN "Acepto" is pressed
- THEN one log row MUST exist with that token's hash, the terms version and a timestamp
- AND no column of that row MUST contain the plaintext token

### Requirement: Invalid, Unknown or Revoked Token Shows a Neutral Page

A token that matches no stored hash MUST render one neutral page, identical for every cause — malformed, never issued, revoked, rotated away, customer deactivated, or customer removed. The page MUST say only that the link is not valid and to ask the workshop for a new one ("Este enlace no es válido. Pedí uno nuevo en el taller."), and MUST NOT reveal whether the token ever existed, why it fails, any customer data, or the workshop's customer count. Status code, body and headers MUST NOT differ between causes. The portal API routes MUST answer every such token with one identical neutral response (HTTP 404, body `{"state":"invalid"}`, same headers), after a single hash lookup and no branching on the cause, so the routes are no oracle. A missing or empty fragment MUST show the same neutral page. The neutral page MUST NOT require the terms gate. "Revoked" and "removed" mean no data is served for that hash; a data-free tombstone MAY remain until the nightly reconcile.

#### Scenario: Unknown token
- GIVEN a well-formed token that was never issued
- WHEN it is opened
- THEN the portal MUST render the neutral page

#### Scenario: Revoked and unknown tokens are indistinguishable
- GIVEN one token whose customer was revoked and one never issued
- WHEN each is opened
- THEN the two responses MUST have the same status code and the same body

#### Scenario: Rotated token
- GIVEN a customer whose code was rotated and synced
- WHEN the old QR is scanned
- THEN the portal MUST render the neutral page and MUST show no data

### Requirement: History View Content

After the terms gate the portal MUST show the orders of every active vehicle of that customer, grouped by vehicle (plate, make, model, year), and MUST show nothing belonging to any other customer. Each order MUST show: its id (matching "N.º" on the printed sheet), its customer-facing status, `categoria`, created date, appointment date and completed date (each only when set), and `description`, `hallazgos` and `recomendaciones` (each only when set). Orders MUST be ordered most recent first. The page MUST show "Actualizado: {fecha}" taken from the time of the last successful sync. A customer with no orders MUST see an explicit empty-state message, not a blank page.

The customer-facing status labels MUST be exactly: "Recibida", "En proceso", "Terminada", "Cancelada". The portal MUST render the label it received and MUST NOT know any internal status.

#### Scenario: Only that customer's data
- GIVEN customers A and B, each synced with their own orders
- WHEN A's token is opened and accepted
- THEN the page MUST list A's orders only and MUST contain no plate or order id of B

#### Scenario: Multi-vehicle history
- GIVEN a customer with two vehicles, each with orders
- WHEN the history renders
- THEN both vehicles MUST appear, each with only its own orders

#### Scenario: Unset text fields are omitted
- GIVEN an order with `hallazgos` set and `recomendaciones` null
- WHEN the history renders
- THEN the findings MUST show and no empty "recomendaciones" block MUST appear

#### Scenario: Staleness is visible
- GIVEN a customer last synced at a known time
- WHEN the history renders
- THEN it MUST show "Actualizado:" followed by that date

#### Scenario: Empty history
- GIVEN a consented customer with no orders
- WHEN the history renders
- THEN it MUST show an empty-state message

### Requirement: Phone-First Spanish Interface

All portal copy MUST be Spanish (Rioplatense, matching the workshop app). The layout MUST be designed for a phone viewport first: single column, no horizontal scroll at 360 px width, and controls (including "Acepto") at least 44x44 px. The portal MUST work without a secure context API, login, or any customer-typed input (no phone number, PIN or cédula is ever asked). JavaScript is required, because the token travels in the URL fragment; with it disabled the shell MUST say so in Spanish and show no data.

#### Scenario: No horizontal scroll on a phone
- GIVEN a 360 px wide viewport
- WHEN the terms and the history render
- THEN the page MUST NOT scroll horizontally

#### Scenario: No credential prompt
- GIVEN any portal page
- WHEN it renders
- THEN it MUST NOT contain a form field for a phone number, PIN, email or cédula

### Requirement: Provisional Legal Text Is Marked

Every legal text the portal shows (the terms, and any privacy notice) MUST carry the banner "TEXTO PROVISORIO — pendiente de revisión legal" until the lawyer's text replaces it. Each legal text MUST carry a version identifier, and that identifier MUST be the one recorded in the acceptance log per token hash. The terms MUST state what is shown, that the data is stored by a cloud provider outside Panama, and how the customer asks the workshop to remove it.

#### Scenario: Banner on the terms
- GIVEN the terms page
- WHEN it renders
- THEN it MUST show the exact banner "TEXTO PROVISORIO — pendiente de revisión legal"

#### Scenario: Replacing the text changes the version
- GIVEN terms text replaced by a new version
- WHEN a token whose recorded acceptance is for the old version opens the portal
- THEN the gate MUST show again

### Requirement: Ingest Endpoint Authentication

The portal MUST accept data only through an ingest endpoint authenticated by HMAC-SHA256 over `timestamp.body` using the shared `PORTAL_INGEST_SECRET`. A request MUST be rejected with 401, writing nothing, when the signature is missing or wrong, or when the timestamp differs from the portal's clock by more than 5 minutes. The signature comparison MUST be constant-time. The endpoint MUST NOT be reachable without the signature for any method.

#### Scenario: Missing or wrong signature
- GIVEN an ingest request with no signature, or one computed with another secret
- WHEN it is received
- THEN the portal MUST respond 401 and MUST persist nothing

#### Scenario: Stale timestamp
- GIVEN a correctly signed request whose timestamp is 6 minutes old
- WHEN it is received
- THEN the portal MUST respond 401 and MUST persist nothing

#### Scenario: Body tampering
- GIVEN a validly signed request whose body is altered after signing
- WHEN it is received
- THEN the portal MUST respond 401

### Requirement: Ingest Payload Is Validated Against the Whitelist

The ingest endpoint MUST validate the body against the strict wire contract (the single dependency-free contract file shared with the workshop) and MUST reject with 400, writing nothing, a body that carries any field outside the whitelist defined in `portal-sync`, a missing required field, or a status other than the four allowed labels. The portal MUST NOT store a field it did not validate.

#### Scenario: Unknown field rejected
- GIVEN a signed upsert body carrying an extra `phone` field
- WHEN it is received
- THEN the portal MUST respond 400 and MUST persist nothing

### Requirement: Upsert Applies Only a Newer Version

The portal MUST keep, per customer, the highest `version` it has accepted and MUST apply an upsert only when its `version` is strictly greater. An older or equal version MUST be acknowledged with a 2xx response and MUST change nothing, so the sender does not retry it. A delete MUST follow the same rule, and the portal MUST retain the version of a delete (a tombstone) so that a delayed older upsert arriving after it MUST NOT resurrect the customer. Deleting a customer that is unknown to the portal MUST succeed with 2xx.

#### Scenario: Newer version wins
- GIVEN a stored snapshot at version 5
- WHEN a signed upsert with version 6 arrives
- THEN the portal MUST replace the snapshot

#### Scenario: Stale upsert is ignored but acknowledged
- GIVEN a stored snapshot at version 6
- WHEN a signed upsert with version 5 arrives
- THEN the portal MUST respond 2xx and MUST leave the snapshot unchanged

#### Scenario: Delayed upsert after delete does not resurrect
- GIVEN a customer deleted at version 7
- WHEN a delayed upsert with version 6 arrives
- THEN the portal MUST NOT store a snapshot for that customer

#### Scenario: Idempotent delete
- GIVEN a customer unknown to the portal
- WHEN a signed delete arrives
- THEN the portal MUST respond 2xx

### Requirement: Portal Stores Only the Token Hash

The portal MUST store the SHA-256 of each token and MUST resolve a visited token by hashing it and looking the hash up. It MUST NOT store, log, or echo the plaintext token, including in request logs, error reports and the acceptance log. Each customer MUST map to exactly one current token hash, so a rotated-away hash MUST resolve to nothing once the new snapshot is stored.

#### Scenario: Database holds no usable code
- GIVEN a portal database dump
- WHEN every column is inspected
- THEN no stored value MUST be a plaintext token, and no stored hash MUST open a portal URL by itself

### Requirement: Portal Response Hardening

Every portal page MUST be served with `noindex` (header and meta), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, including the neutral page and the terms page; every `/api/c/*` response MUST carry `Cache-Control: no-store`.

The three `/api/c/*` routes MUST be rate-limited per client IP (30 requests per 60 s, then 429). A best-effort in-memory limiter is acceptable on a serverless host and its ceiling MUST be recorded in code.

#### Scenario: Rate limit
- GIVEN 31 requests from one IP to `/api/c/open` within 60 s
- WHEN the 31st arrives
- THEN the response MUST be 429 and no hash lookup MUST run

#### Scenario: Headers on every page
- GIVEN the terms page, the history page and the neutral page
- WHEN each is requested
- THEN each response MUST carry `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and a `noindex` directive

### Requirement: Portal Runs Locally Against a Local Database

The portal MUST run locally on port 3001 against a database named `portal` in the existing local Postgres, with its own `package.json`, and MUST NOT require the workshop's `DATABASE_URL`. The portal MUST NOT hold any credential for the workshop database or the workshop's R2 storage.

#### Scenario: Portal boots without workshop credentials
- GIVEN an environment with only the portal's own variables
- WHEN the portal starts and serves the neutral page
- THEN it MUST succeed without reading any workshop variable
