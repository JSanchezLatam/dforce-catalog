# Spec: support-inbox

## Purpose

New capability, on the Vercel customer portal (`portal/`), for the developer only. Copy is from `mockup/index.html`, verbatim. Tags: **[unit]** jsdom or node test; **[e2e]** needs a real Postgres; **[browser]** only provable in a real browser. The area MUST NOT show customer branding, vehicle data or order data. Its header reads "Soporte — Dforce".

## Requirements

### Requirement: Support Login With a Shared Password

The portal MUST gate the whole support area behind one shared password (no username), read from a portal-only environment variable and compared in constant time. A correct password MUST set a signed session cookie that is `httpOnly`, `secure` and `sameSite=strict`; the session MUST be stateless (HMAC with a portal-only secret) and MUST expire. The two new environment variables MUST satisfy the portal's env-isolation test. The login page MUST read "Soporte — Dforce", "Acceso solo para el equipo de desarrollo.", a "Contraseña" field and an "Entrar" button, and MUST NOT use the customer's brand.

#### Scenario: Correct password
- GIVEN the configured password
- WHEN it is submitted
- THEN a session cookie with `httpOnly`, `secure` and `sameSite=strict` MUST be set and the user MUST reach the inbox **[unit]**

#### Scenario: Wrong password shows its error
- GIVEN an incorrect password
- WHEN it is submitted
- THEN no cookie MUST be set, the field MUST be `aria-invalid="true"`, and "Contraseña incorrecta." MUST show **[unit]**

#### Scenario: Tampered or expired cookie
- GIVEN a cookie with an altered signature, or an expired one
- WHEN a support page is requested
- THEN it MUST be treated as no session **[unit]**

#### Scenario: Unset configuration fails closed
- GIVEN the support password or session secret is not configured
- WHEN anyone tries to log in
- THEN login MUST fail and no session MUST be issued **[unit]**

#### Scenario: Salir
- GIVEN a valid session
- WHEN the user activates "Salir"
- THEN the cookie MUST be cleared and the inbox MUST be unreachable until a new login **[unit]**

### Requirement: Failed-Attempt Throttle

Failed login attempts MUST be counted in the database (the in-memory limiter resets on cold start and is not sufficient). After 5 failed attempts within 15 minutes, further attempts MUST be refused for the remainder of a 15-minute lockout, including attempts with the correct password, and MUST show "Demasiados intentos. Probá de nuevo en unos minutos.". A successful login before the threshold MUST clear the count. The lockout MUST survive a cold start or a different server instance.

#### Scenario: Locks out after repeated failures
- GIVEN 5 wrong passwords within 15 minutes
- WHEN a 6th attempt arrives, even with the correct password
- THEN it MUST be refused with the throttle message and no session **[unit]**; counted in the real table **[e2e]**

#### Scenario: Lockout expires
- GIVEN a lockout whose 15 minutes have elapsed
- WHEN the correct password is submitted
- THEN login MUST succeed **[unit]**

#### Scenario: Persists across instances
- GIVEN failures recorded by one instance
- WHEN another instance receives the next attempt
- THEN it MUST see the same count **[e2e]**

#### Scenario: Success resets the count
- GIVEN 4 failures then a correct password
- WHEN the next wrong password arrives
- THEN the count MUST start from 1 **[unit]**

### Requirement: Every Support Page and API Requires a Valid Session

Every support page, server action and API route under the support area MUST verify the session cookie itself, not rely on the login page alone. Without a valid session, a page MUST redirect to the login page and an API or action MUST respond 401 and perform no read or write. This covers the inbox, the detail view, the mark-read, status and note operations, and logout. The support area MUST also be unreachable by a customer token, and its responses MUST carry the portal's existing no-store, no-referrer and noindex headers.

#### Scenario: Pages redirect
- GIVEN no session
- WHEN the inbox or a detail page is requested
- THEN the response MUST redirect to the login page and show no comment data **[unit]**

#### Scenario: Mutations and APIs refuse
- GIVEN no session
- WHEN a status change, a note save or a mark-read is called
- THEN it MUST respond 401 and the row MUST be unchanged **[unit]**; real UPDATE **[e2e]**

#### Scenario: Route inventory
- GIVEN every route and action under the support area
- WHEN the guard test enumerates them
- THEN each MUST be listed as session-protected, and a new unlisted one MUST fail the test **[unit]**

#### Scenario: Hardening headers
- GIVEN any support response
- WHEN inspected
- THEN `Cache-Control: no-store`, `X-Frame-Options: DENY`, noindex and no-referrer MUST be present **[unit]**

### Requirement: Inbox List

The inbox page, titled "Comentarios del taller", MUST list stored feedback newest first by `created_at`. Each row MUST show the category label, a status chip ("Nuevo", "Leído" or "Resuelto"), "<username> · <role label>", the screen label, "Recibido <received_at>", and for a "Nuevo" row an unread marker. The inbox MUST use a wider layout than the customer pages (72rem). On desktop and tablet it MUST show list and detail side by side; on a phone, list and detail MUST be separate views joined by a "Volver" button.

#### Scenario: Row content
- GIVEN a stored comment
- WHEN the list renders
- THEN the row MUST show category, chip, author and role label, screen and received time **[unit]**

#### Scenario: Newest first
- GIVEN comments created at three different times
- WHEN the list renders
- THEN they MUST be ordered by `created_at` descending **[unit]**

#### Scenario: Phone separates list and detail
- GIVEN a phone viewport
- WHEN a row is tapped
- THEN the detail MUST replace the list with a "Volver" button that returns to it **[browser]**

### Requirement: Filters

The inbox MUST filter by status ("Todos", "Nuevo", "Leído", "Resuelto", each with its count), by category ("Todos", "Algo no funciona", "Idea o mejora", "Otra cosa") and by role ("Todos", "Técnico", "Jefe de taller", "Administrador"). Filters MUST combine with AND. The role filter MUST offer only the three real roles. Filtering MUST be applied in the database query, not only in the browser.

#### Scenario: Single filter
- GIVEN rows of mixed status
- WHEN the user picks "Nuevo"
- THEN only Nuevo rows MUST show **[unit]**; real WHERE **[e2e]**

#### Scenario: Filters combine
- GIVEN rows of mixed category, role and status
- WHEN category "Algo no funciona" and role "Técnico" are chosen
- THEN only rows matching both MUST show **[unit]**

#### Scenario: Status counts
- GIVEN 2 Nuevo, 2 Leído, 1 Resuelto
- WHEN the filter renders
- THEN it MUST read "Todos (5)", "Nuevo (2)", "Leído (2)", "Resuelto (1)" **[unit]**

#### Scenario: No results for the filters
- GIVEN stored comments but a filter combination that matches none
- WHEN the list renders
- THEN it MUST show "Ningún comentario coincide con los filtros" and a "Limpiar filtros" button, and activating it MUST reset all filters **[unit]**

### Requirement: Empty Inbox

With no stored comments, the inbox MUST show "No hay comentarios" and "Cuando alguien del taller envíe uno, aparece acá." and MUST NOT show the filters.

#### Scenario: Nothing stored
- GIVEN no comments
- WHEN the inbox renders
- THEN the empty state MUST show and the filters MUST be absent **[unit]**

### Requirement: Delay Flag

A comment MUST be flagged "Llegó con demora" when `received_at - created_at` is strictly greater than 10 minutes; at exactly 10 minutes or less it MUST NOT be. A flagged row MUST show "Llegó con demora · escrito <created_at>" in the list, and the detail MUST show both "Escrito" and "Recibido" times plus "Llegó con demora: estuvo en cola sin internet". Both times MUST be shown for every comment, flagged or not. Times MUST be formatted `dd/MM/yyyy HH:mm` in the workshop's time zone (America/Panama).

#### Scenario: Over ten minutes
- GIVEN created 09:12 and received 14:47 on the same day
- WHEN rendered
- THEN the flag MUST show in the list and the detail, with both times **[unit]**

#### Scenario: Exactly ten minutes is not late
- GIVEN received minus created of exactly 10 minutes
- WHEN rendered
- THEN no flag MUST show **[unit]**

#### Scenario: One second over is late
- GIVEN received minus created of 10 minutes and 1 second
- WHEN rendered
- THEN the flag MUST show **[unit]**

#### Scenario: Prompt delivery
- GIVEN created and received at the same time
- WHEN rendered
- THEN no flag MUST show and both times MUST still be visible **[unit]**

### Requirement: Opening a Nuevo Comment Marks It Leído

Opening a comment whose status is "Nuevo" MUST set it to "Leído". Opening a "Leído" or "Resuelto" comment MUST NOT change its status. A mere list render MUST NOT change any status. The mark-read operation MUST be session-protected and idempotent. On desktop, the comment auto-selected on first render MUST NOT be marked read unless the user opens it.

#### Scenario: Open Nuevo
- GIVEN a Nuevo comment
- WHEN the user opens it
- THEN its status MUST become Leído **[unit]**; real UPDATE **[e2e]**

#### Scenario: Open Resuelto
- GIVEN a Resuelto comment
- WHEN the user opens it
- THEN its status MUST stay Resuelto **[unit]**

#### Scenario: Listing does not read
- GIVEN Nuevo comments
- WHEN the list loads and no row is opened
- THEN every Nuevo MUST remain Nuevo **[unit]**

### Requirement: Status Change and Internal Note

The detail MUST let the developer set the status to "Nuevo", "Leído" or "Resuelto" with a segmented control, and edit one internal note (a single editable field, not a thread) with the placeholder "Solo la ves vos. No llega al taller." and a "Guardar nota" button. Saving MUST confirm with "Nota guardada." in a status region. The note and status MUST never be sent to the workshop. The note MUST have a maximum length of 2000 characters. An unknown status value MUST be rejected with 400.

#### Scenario: Set status
- GIVEN a Leído comment
- WHEN the developer picks "Resuelto"
- THEN the status MUST persist as Resuelto and the chip MUST update **[unit]**; real UPDATE **[e2e]**

#### Scenario: Save note
- GIVEN a typed note
- WHEN the developer activates "Guardar nota"
- THEN the note MUST persist, "Nota guardada." MUST show, and reloading MUST show the same note **[unit]**

#### Scenario: Note replaces, not appends
- GIVEN a saved note
- WHEN a new note is saved
- THEN only the new note MUST remain **[unit]**

#### Scenario: Invalid status
- GIVEN a status value outside the three
- WHEN submitted
- THEN the response MUST be 400 and nothing MUST change **[unit]**

#### Scenario: Nothing goes back to the workshop
- GIVEN a status or note change
- WHEN it is saved
- THEN no request MUST be made to the workshop **[unit]**

### Requirement: Support Touch Targets

Interactive controls in the support area (list rows, filter buttons and selects, status buttons, "Guardar nota", "Salir", "Volver", "Entrar", "Limpiar filtros") MUST measure at least 44px in height, and on a phone the primary buttons MUST be full width. Layout MUST show no horizontal scroll at 390px.

#### Scenario: Hit targets
- GIVEN the inbox at 1280, 820 and 390px, light and dark
- WHEN rendered
- THEN every listed control MUST measure at least 44px tall and the page MUST NOT scroll horizontally **[browser]**
