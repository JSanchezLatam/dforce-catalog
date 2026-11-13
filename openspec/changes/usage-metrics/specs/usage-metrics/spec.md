# Delta for usage-metrics

New capability. The workshop counts screen views anonymously and delivers daily totals to the portal; the portal shows them to the developer in the support area. Copy is from `mockup/index.html`, verbatim. Tags: **[unit]** jsdom or node test; **[e2e]** needs a real Postgres; **[browser]** only provable in a real browser.

## ADDED Requirements

### Requirement: Count a View Per Real Navigation

The `(app)` shell MUST record one view each time the browser's pathname changes to a screen that has an entry in `SCREEN_LABELS`. A re-render, a React StrictMode double effect, a search-param or fragment change, an RSC refresh (`router.refresh()`), an API call and a prefetch MUST NOT record a view. Navigating between two different pathnames of the same pattern (order A, then order B) MUST record two views. The request MUST use `fetch` with `keepalive` and no secure-context API, MUST NOT block rendering, and its failure MUST be silent: no toast, no error, no retry. `pantalla` never mounts the shell and therefore never records a view.

#### Scenario: First screen after login
- GIVEN a user lands on `/service-orders`
- WHEN the shell mounts
- THEN exactly one view for `/service-orders` MUST be sent **[unit]**

#### Scenario: Re-render and StrictMode do not count
- GIVEN the shell is on `/agenda`
- WHEN it re-renders or its effect runs twice under StrictMode
- THEN no further view MUST be sent **[unit]**

#### Scenario: Two orders are two views
- GIVEN the user is on `/service-orders/a`
- WHEN they navigate to `/service-orders/b`
- THEN a second view for `/service-orders/[id]` MUST be sent **[unit]**

#### Scenario: Query change is not a view
- GIVEN the user is on `/customers`
- WHEN only the search params change
- THEN no view MUST be sent **[unit]**

#### Scenario: A failed send is silent
- GIVEN the view request fails or the network is down
- WHEN the user navigates
- THEN nothing MUST be shown and navigation MUST continue **[unit]**

### Requirement: Store Only Day, Screen, Group and Count

The view endpoint MUST derive the role group from the session (`requireSession`), never from the request body: `administrador` and `jefe_taller` count as `gestion`, `tecnico` as `tecnico`; any other role MUST be refused. It MUST accept a screen only if it is a key of `SCREEN_LABELS` and MUST reject anything else with 400 and store nothing. The day MUST be the America/Panama date computed by the database. Storage MUST be one row per `(day, screen, group)` incremented atomically; no user id, username, session, IP, time finer than the day or concrete URL MUST be stored.

#### Scenario: A view increments the day's row
- GIVEN no row for today, `/agenda`, `gestion`
- WHEN an administrador and then a jefe_taller each send a view for `/agenda`
- THEN one row MUST exist for today, `/agenda`, `gestion` with count 2 **[e2e]**

#### Scenario: Concurrent views are not lost
- GIVEN 20 views for the same key sent concurrently
- WHEN they complete
- THEN the row's count MUST be 20 **[e2e]**

#### Scenario: Unknown screen is refused
- GIVEN a body with screen `/service-orders/123` or `/nope`
- WHEN it is posted
- THEN the response MUST be 400 and no row MUST change **[unit]**

#### Scenario: The body cannot choose the group
- GIVEN a técnico's session and a body that also names `gestion`
- WHEN it is posted
- THEN the view MUST count for `tecnico` **[unit]**

#### Scenario: No session
- GIVEN no valid session
- WHEN a view is posted
- THEN the response MUST be 401 and nothing MUST be stored **[unit]**

### Requirement: Deliver Daily Totals With a Watermark

A recurring job MUST send to the portal ingest, as a `usage` body, the counts of every day from the day after the last acknowledged day through today, in batches of at most 31 days. Each batch MUST declare its covered range (`from`, `to`), MUST include days with no views, and MUST carry the workshop's screen catalog (every `SCREEN_LABELS` pattern with its label). Only a 2xx MUST advance the watermark, and only to the last CLOSED day in the batch (never today), so today is always resent. A failure MUST leave the watermark unchanged and be reported without counts. Resending a range MUST NOT duplicate counts.

#### Scenario: Catch up after an outage
- GIVEN the watermark is 40 days old and the portal answers 2xx
- WHEN the job runs
- THEN two batches MUST be sent (31 + 10 days, today included) and the watermark MUST end at yesterday **[e2e]**

#### Scenario: Failure keeps the watermark
- GIVEN the portal answers 5xx or 4xx, or is unreachable
- WHEN the job runs
- THEN the watermark MUST NOT move **[unit]**

#### Scenario: Resending is idempotent on the portal
- GIVEN a range already delivered
- WHEN the same range is delivered again with the same counts
- THEN the portal's totals MUST be unchanged **[e2e]**

### Requirement: Portal Stores the Range It Is Given

The portal MUST accept a `usage` ingest body only with a valid HMAC signature and exact keys. For the declared range it MUST replace the stored counts, MUST record each day of the range as covered with its `received_at`, and MUST replace its screen catalog with the one in the body, all in one transaction. Days outside the range MUST NOT change.

#### Scenario: Replace inside the range only
- GIVEN stored counts for days 1–10
- WHEN a batch covering days 5–7 arrives
- THEN days 5–7 MUST equal the batch and days 1–4 and 8–10 MUST be unchanged **[e2e]**

#### Scenario: Empty day is covered, not missing
- GIVEN a batch whose range includes a Sunday with no views
- WHEN it is applied
- THEN that Sunday MUST be covered with zero views **[e2e]**

#### Scenario: Unknown keys are rejected
- GIVEN a `usage` body with an extra key or a user field
- WHEN it is posted
- THEN the response MUST be 400 and nothing MUST change **[unit]**

### Requirement: Usage Page in the Support Area

`/support/uso` MUST be reachable only with a support session and MUST show, for the chosen range (7 / 30 / 90 días, default 30), the totals per screen and group, the daily trend, the screens of the latest catalog with no views in the range ("Sin visitas en el período"), and the line "Conteos anónimos: por pantalla y grupo, nunca por persona." Days in the range that are not covered MUST be shown as missing (hatched), MUST NOT count as zero, and the summary MUST say how many days have data. When the newest covered day was received more than one day ago, the stale notice MUST show. With no data at all, "Todavía no llegaron datos de uso" MUST show. Exact numbers MUST be in a table; the chart is not the only carrier.

#### Scenario: No session
- GIVEN no support session
- WHEN `/support/uso` is requested
- THEN it MUST redirect to the support login **[unit]**

#### Scenario: Missing days are not zero
- GIVEN a 30-day range where 4 days are not covered
- WHEN the page renders
- THEN it MUST say 26 of 30 days have data and the totals MUST exclude nothing but those days **[unit]**

#### Scenario: Screen never visited
- GIVEN a catalog screen with no views in the range
- WHEN the page renders
- THEN it MUST appear under "Sin visitas en el período" **[unit]**

#### Scenario: Group of one person stays merged
- GIVEN views from the administrador and the jefe_taller
- WHEN the page renders
- THEN only "Gestión" MUST appear, never a per-role split **[unit]**
