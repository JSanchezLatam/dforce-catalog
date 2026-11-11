# Exploration: in-app-feedback

The approved mockup is `mockup/index.html`. The owner's decisions come from the grill of 2026-11-09. The evidence below was gathered with Read, Grep and Glob, because CodeGraph was unavailable.

## Key finding: the portal sync is not an outbox

The mockup says feedback travels via the "mismo mecanismo de outbox". That is not true.

- **What `portal-sync` actually is:** a per-customer pg-boss job. Its payload is `{clienteId}`, and the job re-reads state when it fires (`src/modules/portal-sync/job.ts:134-155`).
- **Retry policy:** the queue is created with `retryLimit: 5, retryDelay: 60, retryBackoff: true`, a dead-letter queue and `policy: "short"` (`enqueue.ts:25-31`). That is roughly 30 minutes of retries, then the job is dead-lettered.
- **Nightly repair:** the reconcile runs at 03:00 America/Panama (`reconcile.ts:28-29,87-90`). It re-enqueues only customers that have a consent row (`reconcile.ts:79`), so it would never pick up feedback.

So the workshop feedback row must be the outbox. `delivered_at IS NULL` drives a recurring sweeper, plus a per-row job as the fast path. The profile's "Pendiente de envío / Enviado" badge is read straight from `delivered_at`.

## Transport and auth (reusable)

- **Config:** `PORTAL_INGEST_URL` and `PORTAL_INGEST_SECRET` come from `src/shared/config/env.ts:94-95`. If either is unset, enqueue and job are no-ops (`enqueue.ts:45`, `job.ts:137`). For feedback that means the row stays queued; it is not lost.
- **Sending:** `sendToPortal` (`transport.ts:36-50`) signs each request with a shared HMAC.
  - The timeout is 15 s, and the URL must be https (plain http only for localhost).
  - A 4xx response throws `PortalRejectedError`, which is not retried. Network errors, timeouts and 5xx are retried.
- **Receiving:** `portal/app/api/ingest/route.ts:16` verifies the signature before it reads the body.
- **Signature window:** `portal/src/contract.ts:46` allows a 300 s clock skew. Each send re-signs, and a replay is harmless as long as the insert is idempotent.
- **Body validation:** `portal/src/ingest/parse.ts` checks exact keys at every level. A new body kind needs changes in three places:
  - the `IngestBody` union in the contract;
  - `parse.ts`;
  - `applyIngest` (`portal/src/ingest/apply.ts:29`).

  `portal/README.md:112` warns never to add a field without extending the whitelist and its tests.

## Workshop DB and module conventions

- **Roles:** `roleEnum` (`src/shared/db/schema.ts:13`) has tecnico, administrador, jefe_taller and pantalla.
  - `pantalla` never reaches the shell: `(app)/layout.tsx:17` redirects it, and `policy.ts:154` sets `account.self: false`.
  - So feedback authors are tecnico, jefe_taller and administrador.
- **Next migration:** 0037, after `0036_order_urgent.sql`.
- **Route registration:** every API route needs an entry in `ROUTE_GUARDS` (`src/modules/auth/route-guards.test.ts:12`).
- **Permissions:** `policy.ts` is an exhaustive per-role matrix, so a new Action `feedback.send` means editing all four role maps.
- **Precedents to copy:**
  - `src/modules/account/` for the module layout and the profile surface;
  - `src/modules/reminders/job.ts` for an idempotent job;
  - `src/modules/portal-sync/` for the forwarding seam.

## Portal side

- **Tables today:** only `portal_customer` and `portal_terms_acceptance`, with migrations 0000 and 0001.
- **Dependencies:** only drizzle, next, pg and react.
- **Auth today:** there is no session or cookie helper. The only auth is the customer token and the ingest HMAC.
- **Rate limiter:** `portal/src/rate-limit.ts` is an in-memory, per-instance limiter that resets on cold start. That is too weak to protect a password login on its own.
- **Headers:** `portal/next.config.ts` already sets no-store, `X-Frame-Options: DENY`, noindex and no-referrer.
- **Deploy:** CLI only, from `portal/`. The project is never connected to Git. Migrations are applied by hand with `npx drizzle-kit migrate` (`portal/README.md:52-69`).
- **Env vars:** any new portal env var must satisfy `portal/src/env-isolation.test.ts`.

## Shell placement

- **Sidebar footer:** `SidebarFooter` is at `src/components/app-sidebar.tsx:380-419`. The new "Enviar comentario" item goes above the user dropdown, as its own `SidebarMenuItem`.
- **Collapsed rail:** the sidebar is `collapsible="icon"`, so the item needs a tooltip when collapsed.
- **Mobile:** below `lg` the sidebar is an off-canvas sheet (`use-mobile.ts:21`).
- **Dialog mount:** mount it in `(app)/layout.tsx` behind a small client provider that exposes `openFeedback()`. Two reasons:
  - when the mobile sheet closes it would unmount a dialog that lives inside it;
  - the "Mis comentarios" card can then reuse the same dialog.
- **Components:** `dialog.tsx` and `sheet.tsx` exist; there is no `textarea.tsx`.
- **Account page:** `account/page.tsx:30-35` renders `ProfileForm` then `PasswordForm`. "Mis comentarios" goes after them.

## Screen context capture

- **Route:** `usePathname()` gives it.
- **Title:** there is no usable page title. Only `src/app/layout.tsx` exports `metadata`, so `document.title` is the same on every page.
- **Approach:** store the route plus a label from a small route-to-label map, for example `/service-orders/[id]` → "Orden de servicio — Detalle".

## Toast

- **Variant:** `info` exists (`Toast.tsx:7,21,27`, `bg-muted`).
- **Choosing the copy:** pick "Comentario enviado" vs. "guardado, se envía solo" from the server response. The browser never talks to the portal; only the LAN server does.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | The workshop row is the outbox. A per-row pg-boss job is the fast path, a recurring sweeper re-enqueues `delivered_at IS NULL` rows, and the portal inserts with `ON CONFLICT (id) DO NOTHING`. | Honors "retried until delivered" and reuses the transport and HMAC. Needs its own sweeper. |
| B | Reuse portal-sync retries as they are. | Smallest change, but it dead-letters after about 30 minutes, and reconcile ignores feedback. |
| C | Send synchronously, and queue only on failure. | Holds the request for up to 15 s and leaves two code paths. |

The dedupe key is a server-generated UUID. No client id is needed, so the insecure-context `randomUUID` trap does not apply.

## Developer login

- **Session:** a stateless HMAC-signed cookie built with `node:crypto`, so no new dependency.
- **Env vars:** two new portal-only vars, a support password and a session secret.
- **Password check:** `timingSafeEqual`.
- **Cookie:** `httpOnly`, `secure`, `sameSite=strict`.
- **Gating:** every inbox page and API checks the same cookie.
- **Throttle:** a DB-backed failed-attempt throttle, because the in-memory limiter resets.

## Risks

- **Shared contract:** `contract.ts` and `parse.ts` are shared with the customer sync. `contract-import.test.ts` and `portal/src/contract.test.ts` must stay green.
- **Manual portal step:** portal migration 0002 is applied by hand after the deploy.
- **Retry storm:** a long outage piles up sends. Use `localConcurrency: 1` and a batched sweeper.
- **Neon and Vercel limits:** cold start and compute suspend were not verified.
- **Things tests cannot see:**
  - the sweeper's real SQL (needs an e2e row);
  - the provider's Server Component boundary;
  - the 44px targets;
  - a check through the LAN IP.
- **Size:** more than 400 lines, so the work ships as chained PRs.
