# Design: In-App Feedback

## Technical Approach

Approach A from `explore.md`, as accepted in `proposal.md`. The workshop `feedback` row is the outbox. The send route stores the row first, then makes one bounded inline attempt. A per-minute sweeper enqueues due rows as per-row pg-boss jobs. Both paths go through one `deliverFeedback()`, which claims the row atomically and reuses `sendToPortal` and its HMAC. The portal gets a third body kind, `feedback`, which it inserts with `ON CONFLICT (id) DO NOTHING`, plus a password-gated `/support` inbox. The customer `portal-sync` queue, its job and the reconcile are not touched (`enqueue.ts:22-32`, `job.ts:160-177`, `reconcile.ts:87-104`).

Specs: `specs/feedback`, `specs/support-inbox`, `specs/customer-portal`, `specs/app-sidebar`.

## Architecture Decisions

| # | Decision | Rejected | Why |
|---|---|---|---|
| D1 | One atomic claim (`UPDATE … WHERE delivered_at IS NULL AND next_attempt_at <= now() RETURNING`) before each send. The claim sets a 2-minute lease. | Advisory lock (`job.ts:119-124`); no guard at all | The inline attempt, the job and the sweeper can race. The claim makes at most one sender per row in one statement, with no connection held across the HTTP call. The portal's idempotent insert is the second line of defense. |
| D2 | The sweeper enqueues per-row jobs (`singletonKey: id`, `retryLimit: 0`). Retry timing lives only in `next_attempt_at`. | pg-boss retries plus a DLQ (the portal-sync shape); a sweeper that sends in a loop | pg-boss retries would add a second backoff clock and a dead-letter, and the spec forbids a dead-letter. Per-row jobs keep one slow row from holding the sweep, and `singletonKey` dedupes overlapping sweeps. |
| D3 | `sendToPortal` gains a 4th positional param, `timeoutMs = REQUEST_TIMEOUT_MS`. The errors gain `status`. | An options object; a copy of the transport | Existing callers pass 2 args (`job.ts:153`, `reconcile.ts:81`), so their behavior is byte-identical. |
| D4 | The server derives the screen label from `route`. | The client sends the label | One source of truth, and the label cannot be spoofed. The dialog shows the same function's output. |
| D5 | The dialog composes `DialogPortal`/`DialogOverlay`/`DialogPopup` directly, with `max-sm:` classes for the bottom sheet. | `DialogContent`; a JS media query that swaps in `Sheet` | `DialogContent`'s wrapper is fixed to `items-center p-4` (`dialog.tsx:50`) and its close button says English "Close" (`dialog.tsx:91`). CSS-only means no hydration branch. |
| D6 | No `textarea.tsx`. Copy the raw `<textarea>` classes from `WorkLineDialog.tsx:174-176`. | Add the shadcn textarea | Four files already use a raw `<textarea>`. A primitive with one new caller is a separate cleanup. |
| D7 | Portal auth is checked per route through `requireSupport()`, plus an inventory test. | `middleware.ts` | The portal has no middleware today. A per-route check is explicit, and the spec requires every page and API route to verify the cookie itself. |
| D8 | One `/support` page holds both list and detail, selected by `?id=`. Mark-read happens on render only when `id` is present. Row links use `prefetch={false}`. | Separate `/support/[id]`; a client POST on mount | This matches the mockup's side-by-side layout. The desktop auto-selected row (no `id`) is not marked read, as the spec requires. Prefetch must be off, or a prefetch would mark rows read. |

No new dependency. The session, HMAC and constant-time compare use `node:crypto`. The time format uses `Intl.DateTimeFormat` with `timeZone: "America/Panama"`.

## 1. Data Model

**Workshop: `feedback`** (`src/shared/db/schema.ts`). Migration 0037 comes from `npm run db:generate -- --name feedback` (`drizzle.config.ts:10`, output folder `src/shared/db/migrations`).

| Column | Type |
|---|---|
| `id` | text PK, `$defaultFn(crypto.randomUUID)`. Server-side Node, the same pattern as `users.id` (`schema.ts:16-18`). |
| `user_id` | text NOT NULL, FK `users.id` |
| `username` | text NOT NULL (snapshot) |
| `role` | `roleEnum` NOT NULL (snapshot of the real role) |
| `category` | `feedbackCategoryEnum = pgEnum("feedback_category", ["bug","idea","other"])` |
| `text` | text NOT NULL, with `CHECK (char_length(text) BETWEEN 1 AND 2000)` |
| `route`, `screen_label` | text NOT NULL |
| `created_at` | timestamptz NOT NULL default now() |
| `delivered_at` | timestamptz NULL |
| `attempts` | integer NOT NULL default 0 |
| `next_attempt_at` | timestamptz NOT NULL default now() |
| `last_error` | text NULL (failure class plus status, never the text) |

Indexes:

- `feedback_pending_idx` on `(created_at)` `WHERE delivered_at IS NULL`, for the sweeper.
- `feedback_user_created_idx` on `(user_id, created_at DESC)`, for "Mis comentarios".

**Portal** (`portal/src/db/schema.ts`). Migration 0002 comes from `cd portal && npx drizzle-kit generate --name support_inbox` (`portal/drizzle.config.ts:9-10`). Both tables ship in the one migration, so the owner runs a single manual `migrate`.

- `support_feedback`:
  - `id`: uuid PK, the workshop id.
  - `username`, `role`, `category`, `text`, `route`, `screen_label`: text NOT NULL.
  - `created_at`: timestamptz NOT NULL.
  - `received_at`: timestamptz NOT NULL default now().
  - `status`: text NOT NULL default `'nuevo'`, with a CHECK on `nuevo`/`leido`/`resuelto`.
  - `internal_note`: text NOT NULL default `''`.
  - Index on `(created_at DESC)`.
  - Text columns follow the portal's convention (`schema.ts:9-17`).
- `support_login_throttle`:
  - `ip`: text PK.
  - `failures`: int NOT NULL.
  - `window_started_at`: timestamptz NOT NULL.
  - `locked_until`: timestamptz NULL.

## 2. Wire Contract

This adds a fourth member to `IngestBody` (`portal/src/contract.ts:32-42`). The three existing members stay byte-identical.

```ts
| { kind: "feedback"; id: string; username: string; role: "tecnico" | "jefe_taller" | "administrador";
    category: "bug" | "idea" | "other"; text: string; route: string; screenLabel: string; createdAt: string }
```

`parse.ts` `build()` gets a fourth branch. It checks `hasExactKeys` on those 9 keys, and the output is rebuilt field by field (`parse.ts:55-79`):

- `id`: matches a UUID regex.
- `role` and `category`: belong to a set.
- `text`: `1 <= .length <= 2000`. JS `.length` (UTF-16), the same measure the workshop route uses, so anything the workshop accepts passes here.
- `route`: starts with `/`, at most 300 characters.
- `screenLabel` and `username`: `str`, at most 200 characters.
- `createdAt`: `!Number.isNaN(Date.parse())`.

`applyIngest` gets `case "feedback"`. It runs `db.insert(supportFeedback).values(…).onConflictDoNothing({ target: id }).returning()` and returns `{ applied }`. The route still answers 200 either way (`route.ts:27`), so a duplicate counts as delivered.

## 3. Send Path

```
POST /api/feedback ─ validate ─ INSERT feedback ─ deliverFeedback(id, 5_000) ─→ { outcome }
cron "* * * * *" feedback-sweep ─ SELECT due ids (LIMIT 25) ─ boss.send(feedback-deliver, {id}, singletonKey)
feedback-deliver (localConcurrency 1) ─ deliverFeedback(id)  [15 s default timeout]
deliverFeedback: claim ─ sendToPortal ─ 2xx: delivered_at = now() │ error: next_attempt_at = now()+backoff, Sentry
```

**Unconfigured portal.** `deliverFeedback` returns `"queued"` before the claim when `PORTAL_INGEST_URL` or `PORTAL_INGEST_SECRET` is unset, and the sweeper returns before its query. The env read is the same as `job.ts:135-137`. The row waits with `attempts` untouched and is delivered once the vars are set.

**Claim.** It runs this, and no row returned means "nothing to do":

```sql
UPDATE feedback SET attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
WHERE id = $1 AND delivered_at IS NULL AND next_attempt_at <= now() RETURNING *
```

**Success.** It sets `delivered_at = now()` and `last_error = NULL`, scoped `WHERE id AND delivered_at IS NULL`.

**Failure.** It sets `next_attempt_at = now() + backoff(attempts)` and `last_error = '<class> <status>'`. `backoff(n)` is `min(2^(n-1), 60)` minutes, so 1, 2, 4 … 60. It grows and is capped at 1 h for every class, 4xx included: a 4xx is not permanent.

**Classification** comes from D3's errors:

| Error | Class |
|---|---|
| `PortalRejectedError.status` | `4xx`. A refused URL has no status and is classed `rejected`. |
| new `PortalServerError.status` | `5xx` |
| `error.name === "TimeoutError"` | `timeout` |
| anything else | `network` |

Every failure calls `Sentry.captureException` with tags `{ job: "feedback-deliver", feedbackId, failure, status, attempt }`. The level is `error` for 4xx, 5xx and rejected, and `warning` for timeout and network. It never carries the text or the secret.

**Contract.** `deliverFeedback` never throws, the same contract as `enqueue.ts:41-56`, so the route always answers.

**Response.** The route answers `201 { id, outcome: "delivered" | "queued" }`. The worker is wrapped with `withJobCapture` (`capture.ts:16`).

**Registration.** `registerFeedbackWorkers()` sits beside the portal workers in `src/instrumentation-node.ts:25-40`. It creates `feedback-deliver` (`policy: "short"`, `retryLimit: 0`) and `feedback-sweep`, then schedules `"* * * * *"` with `tz: "America/Panama"` (the pattern in `reconcile.ts:87-91`).

**Idempotency.** The same `id` goes out on every attempt. The portal's PK plus `DO NOTHING` absorbs a lost 2xx, overlap and replay. The 300 s signature window (`contract.ts:46`) is fine, because every attempt re-signs.

## 4. Policy

- `"feedback.send"` is added to `ACTIONS` (`policy.ts:3-43`), and one cell goes in each of the four maps. It is `true` for tecnico, jefe_taller and administrador, and `false` for pantalla (`policy.ts:126-158`).
- `ROUTE_GUARDS` gets `"/api/feedback": { POST: "feedback.send" }`. The Action and the route must land in the same PR: `route-guards.test.ts:217-237` fails for an Action with no route. The handler follows `api/account/route.ts:8-10`: `requireSession` (401), then `can` (403).
- `/account` is unchanged as a guard (`route-guards.test.ts:120`). The page calls `listOwnFeedback(user.id)` (`WHERE user_id = $1 ORDER BY created_at DESC`) when `can(user, "feedback.send")`. There is no new route.

## 5. Client

- **Provider.** `src/modules/feedback/FeedbackProvider.tsx` (`"use client"`) holds `open` state, exposes `useFeedback().openFeedback`, and renders `<FeedbackDialog>` once. `(app)/layout.tsx` wraps `<AppSidebar>` and `<SidebarInset>` inside `<SidebarProvider>` (`layout.tsx:32-65`). It passes only strings: `author={{ username, roleLabel }}`. `ToastProvider` is already above it, in the root layout. No function crosses the RSC boundary.
- **Constants.** `categories.ts` (ids, labels, placeholders) and `screen-labels.ts` (`screenLabelFor(pathname)`) are plain modules with no `"use client"`, imported by both the route and the dialog.
- **Route-label map.** The pattern table lives in `screen-labels.ts`. An unmapped route falls back to the raw route, as the spec says. A completeness test walks `src/app/(app)/**/page.tsx` and fails on any page without an entry, the same idea as `route-guards.test.ts:202`.
- **Sidebar.** A new `SidebarMenuItem` sits above the user dropdown (`app-sidebar.tsx:380-382`). It is `SidebarMenuButton tooltip="Enviar comentario"` (`sidebar.tsx:518`) with `onClick={() => { setOpenMobile(false); openFeedback(); }}`, and it is a button, not a link. The sidebar rows already rise to 44px on touch (AGENTS.md).
- **Dialog.** Composed as in D5:
  - Desktop and tablet: `max-w-lg` (512px).
  - Phone (`max-sm:`): `items-end p-0`, full width, rounded top, grab handle, footer `flex-col-reverse` so "Cancelar" sits below "Enviar".
  - Category buttons and the footer carry `min-h-11 min-w-11`. The textarea is `text-base`.
  - No secure-context API.
- **Submit.** Copied from `OrderStatusControls.tsx:111-142`:

```ts
let outcome;
try { const r = await fetch("/api/feedback", …); if (!r.ok) { setError(…); return; } outcome = (await r.json()).outcome; }
catch { setError(…); return; }
close();
addToast(outcome === "delivered" ? "success" : "info", outcome === "delivered" ? SENT : QUEUED); // ABOVE
router.refresh();                                                                                 // BELOW try/catch
```

## 6. Portal Support Area

- **Pages:**
  - `/support/login`: client form.
  - `/support`: list plus detail. Filters come from `searchParams` (`status`, `category`, `role`) and go into the SQL `WHERE`. Counts come from one `GROUP BY status`. `?id=` selects the row and marks it read.
- **APIs:**
  - `POST /api/support/login`
  - `POST /api/support/logout`
  - `PATCH /api/support/feedback/[id]`: exact keys from `{status?, internalNote?}`, status in the set, note at most 2000, otherwise 400.
- **Mark-read:** `UPDATE … SET status='leido' WHERE id=$1 AND status='nuevo'`.
- **Env:** `SUPPORT_PASSWORD` and `SUPPORT_SESSION_SECRET` are added to `PORTAL_VARIABLES` (`env-isolation.test.ts:7`). If either is unset, login fails closed and every guard denies.
- **Cookie `support_session`:**
  - Value: `<expSeconds>.<hex HMAC-SHA256(secret, "support:" + exp)>`.
  - Lifetime: 12 h, `Max-Age` 43200.
  - Attributes: `httpOnly`, `secure`, `sameSite=strict`, `path=/`.
  - Verify: the regex `^\d+\.[0-9a-f]{64}$` first (so the lengths are equal), then `exp > now`, then `timingSafeEqual`. This copies `contract.ts:68-75`.
  - The password compare is `timingSafeEqual(sha256(given), sha256(expected))`, which makes the lengths equal.
  - Revoking every session means rotating the secret.
- **Throttle (per first `x-forwarded-for` hop, as `rate-limit.ts:11`):**
  - If `locked_until > now()`, answer 429 with "Demasiados intentos. Probá de nuevo en unos minutos." The password is not checked.
  - Otherwise compare. A miss runs one upsert: the count resets when the window is older than 15 min, otherwise it is incremented, and `locked_until = now()+15 min` once it reaches 5. A success deletes the row.
- **Guard:** `portal/src/support/session.ts` `requireSupport()`.
  - Pages redirect to `/support/login`, and APIs answer 401 before any read or write.
  - `portal/src/support/guard.test.ts` enumerates `app/support/**` and `app/api/support/**` and requires a `requireSupport(` call in each file except login.
- **Headers:** `next.config.ts:23` already matches `/support` and `/api/support`, so it needs no change. The `headers.test.ts` assertion is extended.

## 7. Testing Strategy (Strict TDD)

| Layer | What | Approach |
|---|---|---|
| Unit (node) | `parse` feedback branch, `applyIngest` case, `backoff`, error classification, `deliverFeedback` (claim, send and record as injected seams), the route (401/403/400/2000 vs 2001, author from session), session sign/verify/tamper/expiry, login handler (throttle seams), PATCH validation | Seams in the style of `RunPortalSyncDeps` (`job.ts:126-132`). Fixtures typed as `IngestBody`. |
| Unit (jsdom) | Dialog validation, `aria-pressed`, counter at 1799/1800, locked while sending, toast order with a throwing `refresh`, sidebar opener, "Mis comentarios" badges and empty state, inbox rows/filters/delay flag | `component-testing` skill |
| e2e workshop `src/e2e/feedback.e2e.test.ts` | INSERT and the CHECK; claim (concurrent claims give one winner; a not-yet-due row gives none); sweeper SELECT (due only, oldest first, LIMIT); delivered UPDATE guard; `listOwnFeedback` WHERE | Throwaway DB, as `portal-sync.e2e.test.ts:52-54` |
| e2e portal `portal/e2e/{ingest,support}.e2e.test.ts` | Duplicate id gives 1 row, untouched; concurrent duplicates; `received_at` from the portal clock; throttle upsert, window reset and success delete; mark-read only from nuevo; PATCH UPDATE | `npm run test:e2e` on `dforce_portal_test` |
| Browser (LAN IP) | Dialog from the sidebar at 1280/820/390 (the mobile sheet closes, the dialog stays), rail tooltip, real 44px, console free of RSC and hydration errors, queued toast with the portal unreachable, `/account` card | `http://<ip>:3000` from a second machine |
| Browser (Vercel preview) | Login, lockout, inbox at 1280/820/390 light and dark | Real HTTPS, so the `secure` cookie is set |

**The injected-seam limit.** A green unit run proves zero real SQL. The claim, the sweeper `WHERE`, `ON CONFLICT DO NOTHING`, the throttle upsert and mark-read are each value-bearing SQL, which is why each one has an e2e row above. Every fix is mutation-verified by name.

## 8. Work Units

Each WU is a chained PR. Line counts exclude generated drizzle `meta/*_snapshot.json`.

| WU | Files | Est. |
|---|---|---|
| 1 | `schema.ts` (`feedback`, enum), `migrations/0037_feedback.sql`, `modules/feedback/{categories,screen-labels(+test),service(+test)}.ts` | ~300 |
| 2 | `policy.ts`, `route-guards.test.ts`, `app/api/feedback/route.ts` (+test), store only, outcome `queued` | ~220 |
| 3 | `portal/src/contract.ts`, `ingest/{parse,apply}.ts` (+parse test), `portal/src/db/schema.ts` (+test, both tables), `migrations/0002_support_inbox.sql`, `portal/e2e/ingest.e2e.test.ts` | ~340 |
| 4 | `portal-sync/transport.ts` (+test), `feedback/{deliver,worker}.ts` (+tests), `instrumentation-node.ts` (+test), route uses `deliverFeedback`, `src/e2e/feedback.e2e.test.ts` | ~390 |
| 5 | `feedback/{FeedbackProvider,FeedbackDialog}.tsx` (+test), `(app)/layout.tsx`, `app-sidebar.tsx` (+test) | ~400 |
| 6 | `feedback/MyFeedbackCard.tsx` (+test), `account/page.tsx` | ~200 |
| 7 | `portal/src/support/{session,throttle}.ts` (+tests), `guard.test.ts`, `app/support/login/*`, `app/api/support/{login,logout}/route.ts`, `env-isolation.test.ts`, `portal/e2e/support.e2e.test.ts` (throttle) | ~380 |
| 8 | `portal/src/support/{queries,format}.ts` (+tests), `app/support/page.tsx` plus list and filter components | ~350 |
| 9 | Detail panel, mark-read, `app/api/support/feedback/[id]/route.ts` (+test), note/status client editor, `support.e2e` rows | ~300 |

## Threat Matrix

N/A: there is no shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. The HTTP auth boundaries are covered in §3, §4 and §6.

## Migration / Rollout

Both migrations are additive. Deploy WU3 to Vercel and run the portal migration before WU4 runs in production. A 400 before that is harmless: the row retries at the 1 h cap. Then set the two support env vars in Vercel.

## Open Questions

- [ ] None blocking. Assumption: a 12 h session and a 25-row sweep batch are acceptable defaults.
