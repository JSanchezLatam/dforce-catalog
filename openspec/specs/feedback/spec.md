# Spec: feedback

## Purpose

New capability. Copy is from `mockup/index.html` (owner-approved), verbatim, in Spanish. Tags: **[unit]** jsdom or node test; **[e2e]** needs a real Postgres (injected seams prove no real SQL); **[LAN]** only provable in a browser at `http://<LAN-ip>:3000` (jsdom cannot see layout, hydration, a Server Component boundary or a media query). Author roles are `tecnico`, `jefe_taller` and `administrador`.

## Requirements

### Requirement: Feedback Entry Point and Dialog

Every `(app)` shell screen MUST offer "Enviar comentario", which opens one dialog mounted once in the shell layout behind a client provider that exposes `openFeedback()`, so the sidebar item and the "Mis comentarios" button open the same dialog. The dialog MUST be a centered modal on desktop and tablet and a bottom sheet on a phone. Its title MUST be "Enviar comentario" and its description "Contale al equipo de soporte qué anda mal o qué mejorarías.". It MUST NOT use any secure-context-only browser API (clipboard, screen capture, camera, `crypto.randomUUID`, `crypto.subtle`).

#### Scenario: One dialog, several openers
- GIVEN the shell with the sidebar item and, on `/account`, the "Mis comentarios" button
- WHEN either is activated
- THEN the same dialog MUST open, and closing the mobile nav sheet MUST NOT unmount it **[unit]**; no hydration or RSC-boundary error in the console **[LAN]**

#### Scenario: Phone bottom sheet
- GIVEN a phone viewport (390px)
- WHEN the dialog opens
- THEN it MUST render as a bottom sheet with a grab handle, full width, rounded top corners, and the footer buttons stacked full-width with "Cancelar" below "Enviar" **[LAN]**

#### Scenario: Modal on desktop and tablet
- GIVEN a 1280px or 820px viewport
- WHEN the dialog opens
- THEN it MUST be a centered modal no wider than 512px **[LAN]**

### Requirement: Required Category With No Preselection

The dialog MUST offer three categories under the legend "¿Qué querés contarnos?": "Algo no funciona" (`bug`), "Idea o mejora" (`idea`) and "Otra cosa" (`other`). None MUST be selected when the dialog opens. The category MUST be required. The textarea placeholder MUST follow the selected category (before any selection it uses the `bug` placeholder):
- `bug`: "Escribí qué pasó y qué estabas haciendo. Por ejemplo: «Al guardar la orden me salió un error y se borró lo que había cargado»."
- `idea`: "Contanos qué te ahorraría tiempo. Por ejemplo: «Estaría bueno filtrar el tablero por técnico»."
- `other`: "Escribí lo que quieras contarle al equipo de soporte."

#### Scenario: Nothing preselected
- GIVEN the dialog is opened
- WHEN it renders
- THEN no category button MUST have `aria-pressed="true"` **[unit]**

#### Scenario: Placeholder follows the category
- GIVEN the dialog with no selection
- WHEN the user picks "Idea o mejora"
- THEN the textarea placeholder MUST read the `idea` text **[unit]**

#### Scenario: Missing category
- GIVEN text typed and no category chosen
- WHEN the user activates "Enviar"
- THEN no request MUST be sent and the message "Elegí qué querés contarnos." MUST show under the categories **[unit]**

#### Scenario: Empty or whitespace-only text
- GIVEN a category chosen and a text that is empty or only whitespace
- WHEN the user activates "Enviar"
- THEN no request MUST be sent, the textarea MUST be `aria-invalid="true"`, and "Escribí tu comentario antes de enviarlo." MUST show **[unit]**

#### Scenario: Both missing
- GIVEN neither a category nor text
- WHEN the user activates "Enviar"
- THEN both messages MUST show **[unit]**

#### Scenario: Server revalidates
- GIVEN a request to the send route with a missing or unknown category, or blank text
- WHEN it is received
- THEN the server MUST respond 400 and MUST persist nothing **[unit]**

### Requirement: Text Limit of 2000 Characters

The comment text MUST be at most 2000 characters, enforced by the textarea (`maxLength`), by the server (400 and nothing persisted beyond it) and by a database check. The dialog MUST show a live counter "N / 2000" that turns amber from 1800 characters. Text MUST be stored trimmed (leading and trailing whitespace removed), and the 2000 limit MUST be measured on that trimmed value.

#### Scenario: Counter
- GIVEN 1799 then 1800 typed characters
- WHEN the counter renders
- THEN it MUST read "1799 / 2000" without the warning class, then "1800 / 2000" with it **[unit]**

#### Scenario: Exactly 2000 accepted, 2001 refused
- GIVEN a 2000-character text and a 2001-character text sent directly to the route
- WHEN each is received
- THEN the first MUST be stored and the second MUST get 400 and write nothing **[unit]**

### Requirement: Screen Context Capture

On send, the client MUST include the current route (`usePathname()`) and the server MUST derive a human label from a route-to-label map (for example `/service-orders/[id]` becomes "Orden de servicio — Detalle"); a route with no map entry MUST fall back to the raw route as its label. The dialog MUST show the context read-only as "Pantalla: <label>". It MUST capture only the route and label, never page content. The stored route MUST be the pathname without query string or fragment.

#### Scenario: Mapped route
- GIVEN the dialog opened on an order detail page
- WHEN it renders
- THEN it MUST read "Pantalla: " followed by the mapped label, and the sent payload MUST carry that route **[unit]**

#### Scenario: Unmapped route
- GIVEN a route absent from the map
- WHEN the comment is stored
- THEN the label MUST be the route itself and the send MUST NOT fail **[unit]**

#### Scenario: Context is not editable
- GIVEN the open dialog
- WHEN the user inspects the context lines
- THEN they MUST NOT be form controls **[unit]**

### Requirement: Author Username and Role

The server MUST take the author from the session, never from the request body: it MUST store the user's id, username and real role (`tecnico`, `jefe_taller` or `administrador`) with the comment. The dialog MUST show "Se envía al equipo de soporte como <username> (<role label>)". A new Action `feedback.send` MUST be granted in the permission matrix to `tecnico`, `jefe_taller` and `administrador` and denied to `pantalla`, and the send route MUST be registered in `ROUTE_GUARDS`.

#### Scenario: Author comes from the session
- GIVEN a request body that also carries a different `username` and `role`
- WHEN the server stores the comment
- THEN the row MUST hold the session user's username and role **[unit]**

#### Scenario: Dialog names the author
- GIVEN a técnico "jperez"
- WHEN the dialog renders
- THEN it MUST read "Se envía al equipo de soporte como jperez (Técnico)" **[unit]**

#### Scenario: Pantalla cannot send
- GIVEN a session with role `pantalla`
- WHEN it calls the send route
- THEN the server MUST respond 403 and MUST persist nothing **[unit]**

#### Scenario: No session
- GIVEN no session
- WHEN the send route is called
- THEN the server MUST respond 401 and MUST persist nothing **[unit]**

### Requirement: Stored Before Sent, With One Bounded Inline Send

The server MUST persist the comment (server-generated UUID, author, category, text, route, label, `created_at`, `delivered_at` NULL) before any attempt to reach the portal, so a comment is never lost because the portal is unreachable. It MUST then make exactly one inline send attempt bounded by a timeout shorter than the transport default (about 5 seconds), so the dialog does not hang offline. The id MUST be generated by the server.

#### Scenario: Saved even when the portal is down
- GIVEN the portal is unreachable
- WHEN a valid comment is sent
- THEN a row MUST exist with `delivered_at` NULL and the route MUST respond success with a "queued" outcome **[unit]**; real insert **[e2e]**

#### Scenario: Inline send is bounded
- GIVEN a portal that never answers
- WHEN a valid comment is sent
- THEN the route MUST answer within the inline timeout rather than the transport's 15 seconds **[unit]**

#### Scenario: Unconfigured portal
- GIVEN `PORTAL_INGEST_URL` or `PORTAL_INGEST_SECRET` is unset
- WHEN a valid comment is sent
- THEN the row MUST be stored and queued, not lost and not an error **[unit]**

### Requirement: Send Outcome Maps to the Toast

While sending, the dialog MUST disable its controls and show "Enviando…". When the server reports a delivered outcome (the inline send got 2xx), the dialog MUST close and a success toast "Comentario enviado" MUST show. When it reports a queued outcome, the dialog MUST close and an info toast "Comentario guardado. Se va a enviar automáticamente cuando vuelva la conexión." MUST show (the neutral variant, not red). The toast MUST be raised above `router.refresh()`, both below the `try/catch`. Only a failure to store (network error to the LAN server, 4xx or 5xx from the workshop route) MUST be shown as an inline error with the text kept, never as a toast.

#### Scenario: Delivered
- GIVEN the route answers outcome `delivered`
- WHEN the send completes
- THEN the success toast "Comentario enviado" MUST show and the dialog MUST close **[unit]**

#### Scenario: Queued
- GIVEN the route answers outcome `queued`
- WHEN the send completes
- THEN the info toast "Comentario guardado. Se va a enviar automáticamente cuando vuelva la conexión." MUST show and the dialog MUST close **[unit]**

#### Scenario: Controls locked while sending
- GIVEN a send in flight
- WHEN the dialog renders
- THEN the category buttons, textarea, "Cancelar" and the close button MUST be disabled and "Enviar" MUST read "Enviando…" **[unit]**

#### Scenario: Refresh failure does not retract the toast
- GIVEN the server accepted the comment and `router.refresh()` throws
- WHEN the handler runs
- THEN the toast MUST already have been raised **[unit]**

### Requirement: Outbox Delivers Until the Portal Confirms

A comment is delivered only when the portal answers 2xx, and only then MUST `delivered_at` be set (to the delivery time). A 4xx, a 5xx, a timeout or any network failure MUST leave `delivered_at` NULL. Undelivered rows MUST be retried by a per-row job (fast path) and by a recurring batched sweeper that re-enqueues every `delivered_at IS NULL` row, with no maximum attempt count and no dead-letter, until the row is delivered. The send MUST reuse the existing signed transport (`sendToPortal`, HMAC). Retries MUST run with a concurrency of 1, and a job that finds its row already delivered MUST do nothing. The customer `portal-sync` queue, its retry policy and the nightly reconcile MUST NOT be modified.

#### Scenario: 2xx sets delivered_at
- GIVEN a queued row
- WHEN the portal answers 2xx
- THEN `delivered_at` MUST be set and no further attempt MUST be made **[unit]**; real UPDATE **[e2e]**

#### Scenario: Each failure class leaves it queued
- GIVEN a queued row
- WHEN the portal answers 4xx, answers 5xx, times out, or the network fails
- THEN `delivered_at` MUST stay NULL in every case **[unit]**

#### Scenario: Retries continue past the old dead-letter horizon
- GIVEN a row undelivered for more than 30 minutes
- WHEN the sweeper runs
- THEN the row MUST be attempted again, not abandoned **[unit]**; sweeper selection SQL **[e2e]**

#### Scenario: Already-delivered row is a no-op
- GIVEN a job fires for a row whose `delivered_at` is set
- WHEN it runs
- THEN no request MUST be sent **[unit]**

#### Scenario: Sweeper is batched
- GIVEN more undelivered rows than one batch
- WHEN the sweeper runs
- THEN it MUST enqueue at most one batch per run, oldest first **[unit]**; real SQL **[e2e]**

#### Scenario: Customer sync untouched
- GIVEN the change is applied
- WHEN the existing `portal-sync` and contract tests run
- THEN they MUST pass unchanged **[unit]**

### Requirement: A Rejected Row Is Not Retried in a Tight Loop

A row that keeps failing, in particular one the portal rejects with 4xx (for example the portal has not yet been deployed with the `feedback` kind), MUST be retried with bounded exponential backoff: each consecutive failure MUST lengthen the minimum wait before that row's next attempt, up to a cap of 1 hour, and neither the per-row job nor the sweeper MAY attempt a row before its wait has elapsed. A 4xx MUST NOT be treated as permanent: the row MUST keep being retried at the capped interval so it recovers once the portal accepts it. Every failed attempt MUST be reported to Sentry with the row id, the failure class (4xx status, 5xx status, timeout or network) and the attempt count, and MUST NOT include the comment text or the signing secret. Failures that are plain loss of internet MAY be reported at lower severity than a 4xx, but MUST still be observable.

#### Scenario: Backoff grows and is capped
- GIVEN a row that fails on consecutive attempts
- WHEN the next-attempt time is computed after each failure
- THEN each wait MUST be at least the previous one, and no wait MUST exceed 1 hour **[unit]**

#### Scenario: Sweeper respects the wait
- GIVEN an undelivered row whose backoff has not elapsed
- WHEN the sweeper runs
- THEN that row MUST NOT be attempted **[unit]**; real SQL **[e2e]**

#### Scenario: Repeated 4xx is observable
- GIVEN a portal that answers 400 for a row
- WHEN the row fails repeatedly
- THEN a Sentry event MUST be recorded per failed attempt carrying the row id, status and attempt count, and no text **[unit]**

#### Scenario: Recovery after a 4xx
- GIVEN a row that failed with 400 several times
- WHEN the portal later answers 2xx
- THEN `delivered_at` MUST be set and retries MUST stop **[unit]**

### Requirement: Duplicate Sends Are Safe

Every attempt for a row MUST carry the same server-generated UUID as its portal identity, so that a re-send after a lost 2xx, a sweeper/job overlap or a replayed request produces no second portal row (see `customer-portal`).

#### Scenario: Same id on every attempt
- GIVEN a row sent twice
- WHEN both payloads are built
- THEN both MUST carry the same `id` **[unit]**

### Requirement: Mis comentarios Shows Only the User's Own Rows

`/account` MUST render, after the existing profile and password forms, a card "Mis comentarios" with the description "Lo que enviaste al equipo de soporte." and a button "Enviar comentario" that opens the shared dialog. It MUST list only rows authored by the current user, newest first by `created_at`, with no pagination in v1. Each row MUST show its category badge, the text on one line truncated with an ellipsis, "<created_at> · <screen label>", and a delivery badge: "Enviado" when `delivered_at` is set and "Pendiente de envío" otherwise, the latter followed by "Sin conexión a internet. Se envía solo cuando vuelva.". The card MUST NOT show a "Respondido" state. With no rows it MUST show the empty state "Todavía no enviaste comentarios" with "Usá «Enviar comentario» en el menú para contarnos qué anda mal o qué mejorarías.".

#### Scenario: Own rows only
- GIVEN comments by user A and user B
- WHEN user A opens `/account`
- THEN only A's comments MUST be listed **[unit]**; real WHERE **[e2e]**

#### Scenario: Newest first
- GIVEN three comments created on different times
- WHEN the card renders
- THEN they MUST be ordered by `created_at` descending **[unit]**

#### Scenario: Delivery badges
- GIVEN one delivered row and one with `delivered_at` NULL
- WHEN the card renders
- THEN the first MUST read "Enviado" and the second "Pendiente de envío" with the offline explanation **[unit]**

#### Scenario: Flips after reconnection
- GIVEN a "Pendiente de envío" row that the outbox then delivers
- WHEN the page is next loaded
- THEN the row MUST read "Enviado" **[unit]**

#### Scenario: Empty state
- GIVEN a user with no comments
- WHEN the card renders
- THEN the empty-state title and hint MUST show **[unit]**

#### Scenario: No Respondido
- GIVEN any list
- WHEN rendered
- THEN no element MUST read "Respondido" **[unit]**

#### Scenario: Pantalla has no account page
- GIVEN the existing rule that `pantalla` never reaches the shell
- WHEN a pantalla session requests `/account`
- THEN behavior MUST be unchanged by this change **[unit]**

### Requirement: Touch Targets and Accessibility

Every action control in the dialog (category buttons, "Enviar", "Cancelar", the close button) and the "Mis comentarios" button MUST measure at least 44x44px on a touch device. The textarea MUST use a 16px font on touch to avoid iOS zoom-on-focus. The dialog MUST be `role="dialog"` with `aria-modal`, labelled by its title; the character counter MUST be `aria-live="polite"`; the category group MUST use a `fieldset` with its legend. The category buttons MUST expose their state with `aria-pressed`.

#### Scenario: Roles and labels
- GIVEN the open dialog
- WHEN queried by role
- THEN it MUST be a labelled dialog and the category buttons MUST expose `aria-pressed` **[unit]**

#### Scenario: Touch size classes
- GIVEN the dialog controls
- WHEN rendered
- THEN each MUST carry the `min-h-11 min-w-11` or `pointer-coarse:` classes the repo uses for 44px **[unit]**; actual height **[LAN]**

#### Scenario: Reachable by IP
- GIVEN the app opened at `http://<LAN-ip>:3000` from another machine
- WHEN the dialog is opened and a comment sent
- THEN no console error MUST appear and the send MUST succeed **[LAN]**
