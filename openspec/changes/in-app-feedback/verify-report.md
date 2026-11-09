# Verification Report: in-app-feedback

Branch `feat/in-app-feedback` @ 4a80b0e. Mode: hybrid (file only, no `mem_save`). Strict TDD: active. Date 2026-11-09.

## Verdict: PASS WITH WARNINGS (0 CRITICAL, 4 WARNING, 3 SUGGESTION)

## Completeness
Tasks: all checked except 9.4 (stale bookkeeping: its PR #353 is merged at ec3724e and the mutations/gates are recorded done) and 10.2 (deployed-portal run, blocked on owner manual steps).

## Runtime evidence (re-run in this phase)
| Command | Result |
|---|---|
| `npm test` (root) | 296 files, 4669/4669 passed |
| `npx tsc --noEmit` (root) | exit 0 |
| `npm run lint` | 0 errors, 13 warnings (matches the AGENTS.md count) |
| `cd portal && npm test` | 27 files, 231/231 passed |
| `cd portal && npx tsc --noEmit` | exit 0 |

Not re-run (orchestrator-measured, throwaway DBs only): e2e feedback 9/9, portal ingest 17/17, portal support 34/34; `test:portal-sync` 10/11 with the one failure identical on main (049c797).

## Spec compliance (test that proves it; e2e files named where SQL is the claim)
Paths: W = `src/modules/feedback`, P = `portal`.

### feedback (13 requirements)
| Scenario | Evidence |
|---|---|
| One dialog, several openers | app-sidebar.test "opens the feedback dialog", "closes the mobile sheet and keeps the dialog mounted"; MyFeedbackCard.test "opens the shared dialog from the button". [LAN] browser 5.5 |
| Phone bottom sheet / Modal desktop+tablet | [LAN] only: browser 5.5 (checked, not re-observed here) |
| Nothing preselected | FeedbackDialog.test "preselects no category" |
| Placeholder follows category | "follows the category with the placeholder, starting on the bug text" |
| Missing category / whitespace / both | "shows the missing-category message...", "flags whitespace-only text...", "shows both messages..." |
| Server revalidates | api/feedback/route.test it.each 400 cases (line 83), "400 for malformed JSON..." |
| Counter | "caps the textarea at 2000 and counts live, amber from 1800" |
| 2000 ok / 2001 refused | route.test "accepts exactly 2000 characters and refuses 2001..."; service.test "accepts exactly 2000", "rejects 2001", "measures the limit on the trimmed value"; e2e "enforces the 1..2000 CHECK" |
| Mapped / unmapped route | screen-labels.test "maps a dynamic route", "falls back to the raw route", "strips query and fragment"; service.test "stores the route without query or fragment"; Dialog "shows the screen read-only..."; "has a label for every (app) page" |
| Context not editable | Dialog "renders the context lines as text, not as form controls" |
| Author from session | route.test "stamps author and role from the SESSION and ignores body attempts" |
| Dialog names author | Dialog "names the author with the role label" |
| Pantalla 403 / no session 401 | route.test "403 for pantalla, without touching the service", "401 when the request carries no session"; policy.test matrix; route-guards.test `/api/feedback` |
| Saved when portal down / unconfigured | deliver.test it.each unconfigured -> queued; "never throws..."; route.test "delivers inline ... answers its outcome"; e2e insert |
| Inline send bounded | deliver.test "passes the inline timeout to the transport"; route.test 5 s; transport.test "honors an explicit timeoutMs" |
| Delivered / Queued toast | Dialog "raises a success toast...", "raises the neutral info toast on a queued outcome" |
| Controls locked | "locks every control and reads Enviando…..." |
| Refresh failure keeps toast | "has already raised the toast when router.refresh throws" |
| Store failure inline, no toast | "keeps the text and shows an inline error, with no toast, on a 5xx", "...on a 400", "...fetch rejects" |
| 2xx sets delivered_at | deliver.test "on a 2xx marks delivered"; e2e "delivers through the real claim and marks delivered_at once" |
| Each failure class stays queued | deliver.test 4xx/5xx/timeout/network block (line 129) |
| Retries past 30 min / sweeper batched | worker.test "asks for at most 25 due rows..."; e2e "the sweeper takes due undelivered rows only, oldest first, and honors the LIMIT" |
| Already delivered no-op | deliver.test "sends nothing when the claim finds no due, undelivered row"; e2e "the delivered guard" |
| Customer sync untouched | transport.test status/timeout cases; portal-sync suite green in root run |
| Backoff grows, capped | deliver.test "is 1, 2, 4 ... and capped at 60, monotone" |
| Sweeper respects wait | e2e "does not claim a not-yet-due row", "leases the claimed row" |
| Repeated 4xx observable | deliver.test "reports to Sentry with id, status and attempt, and never the text or the secret", "reports 4xx as an error and a timeout as a warning" |
| Recovery after 4xx | deliver.test "recovers after a 4xx..." |
| Same id every attempt | deliver.test "sends a body the portal's own parser accepts, with the row's id"; "recovers after a 4xx ... same id" |
| Own rows only / newest first | account/page.test "reads only the signed-in user's comments..."; MyFeedbackCard "lists the rows in the order received"; service.test "asks the seam for that user only"; e2e "listOwnFeedback returns only the caller's rows, newest first, in SQL" |
| Delivery badges / empty / no Respondido | MyFeedbackCard "reads Enviado ... Pendiente de envío with the offline text", "shows the empty state", "never shows a Respondido state" |
| Flips after reconnection | No dedicated test; derived from the badge test (render is a pure function of `delivered_at`) plus browser 6.3. See W3 |
| Pantalla has no account page | layout.test "redirects a pantalla session to its landing before the shell..." |
| Roles and labels / touch classes | Dialog "marks only the chosen category as pressed", "titles itself..."; "carries the 44px classes on every action control" |
| Reachable by IP | [LAN] browser 5.5 / 6.3 / 10.1 local portal; deployed run open (10.2) |

### customer-portal (2 modified/added groups)
| Scenario | Evidence |
|---|---|
| Unknown field / unknown kind / customer unchanged | P parse.test "rejects a wrong or missing kind", "rejects an extra key at every level", "accepts the three wire shapes unchanged"; contract-import test in root run |
| Feedback accepted / extra field / invalid field | parse.test "accepts the exact wire shape...", "rejects extra keys the portal must stamp itself", "rejects a missing field", "rejects bad values", "accepts the boundaries"; ingest.e2e "inserts a row..." and "a body carrying receivedAt is refused" |
| Unsigned feedback | ingest route.test "feedback: unsigned is 401 and never applied..." |
| Duplicate send / no overwrite / concurrent | apply.test "is ON CONFLICT (id) DO NOTHING...", "reports applied only when a row was inserted"; ingest.e2e "a duplicate id leaves the first row untouched, even after it was worked on", "concurrent duplicates end in one row and both answer 2xx" |
| Server clock / initial state | apply.test "inserts the nine wire fields only: status, note and received_at are left to the database"; ingest.e2e "inserts a row: nuevo, empty note, received_at from the portal clock" |
| Queued comment keeps both times | Same e2e row (created_at from workshop, received_at from portal); no explicit 3-hour case. See S1 |

### app-sidebar
All seven scenarios covered: app-sidebar.test "sits in the footer immediately before the user card", "opens the feedback dialog", "in the collapsed rail keeps the accessible name and shows the tooltip", "closes the mobile sheet and keeps the dialog mounted", "is absent for a role without feedback.send"; existing sidebar tests unchanged and green. Hit target: classes in the Dialog 44px test cover the dialog; measured 44px for the sidebar item is browser-only (5.5).

### support-inbox
| Scenario | Evidence |
|---|---|
| Correct / wrong password / unset config | P login.test "a correct password sets the session cookie...", "a wrong password answers 401...", fail-closed it.each; session.test cookie attributes; LoginForm.test "a 401 marks the field invalid..."; login/page.test copy |
| Tampered or expired cookie | session.test "rejects an expired value", "rejects an altered signature", "rejects an extended expiry..." |
| Salir | logout route.test "clears the cookie...", "answers 401..."; LogoutButton.test |
| Locks out / expires / resets / across instances | login.test "a locked IP is refused ... even with the correct password"; support.e2e "five failures lock; the sixth is refused...", "a lock that has elapsed...", "a success deletes the row...", "the lock is shared by a second server instance", "failures recorded by two instances add up". Unit throttle.test only covers IP parsing. See W2 |
| Pages redirect / mutations refuse / route inventory | support/page.test "redirects to the login page without a session, and reads no data"; PATCH route.test "answers 401 without a session and touches nothing"; guard.test route inventory |
| Hardening headers | headers.test it.each over support paths |
| Row content / newest first | support/page.test "shows category, status chip, author and role, screen, received time and the unread marker"; "keeps the order the query returns"; e2e "lists newest first by created_at" |
| Phone separates list/detail | [browser] 9.5 (local portal); test "Volver goes back to the list keeping the current filters" |
| Filters single / AND / counts / no results | page.test "shows the status counts: Todos (5)...", "with stored comments but none matching...", "passes only the parsed filters to the query"; e2e WHERE/AND/GROUP BY rows |
| Empty inbox | page.test "with no comments stored: empty state, and no filters" |
| Delay flag (4 scenarios) | format.test "is not late at exactly 10:00", "is late one second over (10:01)", "is not late when delivered at the same instant"; page.test "flags a comment received more than 10 minutes late...", "shows both times but no delay flag for a prompt comment" |
| Open Nuevo / Resuelto / list does not read | page.test "with ?id= marks that row read BEFORE reading it back", readonly.test "writes nothing..."; e2e "mark-read turns a nuevo row into leido", "...leaves a resuelto row resuelto", "listing and counting change no status" |
| Set status / save note / replaces / invalid | PATCH route.test "saves a status", "saves a note, and a note of exactly 2000", "rejects a status outside the three with 400", "rejects a note of 2001 characters"; FeedbackEditor.test "Guardar nota PATCHes only the note and shows Nota guardada."; e2e "the note REPLACES the previous one" |
| Nothing goes back to the workshop | UNCOVERED by a test. Structurally true (the portal has no workshop client; editor tests assert the only fetch is the PATCH). See W4 |
| Support touch targets | [browser] 9.5 (local portal); no jsdom measurement possible |

Totals counted from the specs: 4 delta specs; 19 requirements (feedback 13, customer-portal 3 incl. modified, app-sidebar 1, support-inbox 9, rounding by header count: feedback 13 + customer-portal 3 + app-sidebar 1 + support-inbox 9 = 26 requirement headers); scenarios 140 approx. UNCOVERED by an automated test: 1 (workshop isolation), plus 1 derived-only (flips after reconnection), plus browser/LAN-only scenarios.

## Design coherence
Outbox claim/lease/backoff, sweeper cap 25, `singletonKey`, localConcurrency 1, `ON CONFLICT DO NOTHING`, DB-counted throttle, HMAC stateless cookie, per-entry-point session check (guard.test) all match design and tasks. No deviations found.

## Strict TDD
TDD cycle evidence table (apply-progress) was not available to this phase (no Engram). Tasks.md records RED-by-name and mutation counts per WU (15, 25, 13, 10 mutations). Assertion scan: no tautologies; the two "empty" checks (`readonly.test`, empty-state tests) have non-empty companions. The `getByRole`-loop ghost risk was not exhaustively audited.

## Issues
### CRITICAL
None.

### WARNING
- W1. Task 10.2 open: end-to-end against the DEPLOYED portal not run (owner manual steps: env vars, migration 0002, deploy). Secure-cookie login and the Vercel preview pass (task 7.5 / 9.5 note) are unverified in production-like conditions. Blocks archive until done or explicitly waived by the owner.
- W2. Throttle behavior scenarios tagged [unit] (lockout expiry, success resets count) are proven by e2e rows and by login.test with a mocked throttle, not by a pure unit test of `throttle.ts`; `throttle.test.ts` covers only IP parsing. Coverage is real (e2e green) but needs a Postgres.
- W3. "Flips after reconnection" has no dedicated test; it relies on the badge render test and browser task 6.3.
- W4. "Nothing goes back to the workshop" has no test (structural absence).

### SUGGESTION
- S1. Add an explicit 3-hour `created_at` vs `received_at` e2e assertion for "Queued comment keeps both times".
- S2. Tick task 9.4 in tasks.md (PR #353 merged) so archive tooling does not read it as open.
- S3. `test:portal-sync` pre-existing failure ("shows no plate and no order before the terms are accepted") deserves its own change.

## Notes
Requirement count in the envelope is the number of requirement headers in the four delta specs (26); scenario total is an approximation (about 140) and was not machine-counted. `gentle-ai sdd-verify-validate` was not run (no authoritative counts supplied).
