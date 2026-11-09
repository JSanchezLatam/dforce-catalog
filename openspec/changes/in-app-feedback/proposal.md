# Proposal: In-App Feedback

## Intent

Workshop users (tecnico, jefe_taller, administrador) have no channel to report a bug or suggest an idea at the moment it happens; reports arrive late, by word of mouth, without the screen they refer to. Give every shell screen an "Enviar comentario" entry that reaches the developer ("el equipo de soporte") even when the workshop is offline, and give the developer a private inbox on the Vercel portal.

Source of truth for copy and layout: `mockup/index.html` (owner-approved). Decisions: owner grill 2026-11-09, `explore.md`.

**Mockup correction:** it says feedback uses the "mismo mecanismo de outbox" as the portal sync. False: `portal-sync` is a per-customer pg-boss job that dead-letters after ~30 min, and the nightly reconcile only visits consented customers. Feedback gets a **new outbox** (its own table plus a sweeper) that **reuses** `sendToPortal` and the HMAC.

## Scope

### In Scope
- Workshop: sidebar footer item (tooltip in the rail), dialog mounted once in `(app)/layout.tsx` via a client provider. Required category with no preselection (bug / idea / other), text ≤2000 chars, read-only screen context (route + label from a route-to-label map).
- Server stores username, real role, created_at, then makes one bounded inline send. The toast reports the response: "Comentario enviado" (success) or "Comentario guardado. Se va a enviar automáticamente cuando vuelva la conexión." (info).
- Outbox: `delivered_at IS NULL` rows retried by a per-row job plus a recurring batched sweeper, until delivered. Only a 2xx sets `delivered_at`.
- "Mis comentarios" card on `/account`: own rows only, Enviado / Pendiente de envío.
- Portal ingest: new `feedback` body kind, idempotent insert by server UUID (`ON CONFLICT DO NOTHING`), `received_at` stamped by the portal.
- Portal support area: password login (signed httpOnly/secure/strict cookie, DB-backed failed-attempt throttle), inbox filtered by status (Nuevo / Leído / Resuelto), category and role. "Llegó con demora" when received − created > 10 min. Opening a Nuevo marks it Leído. Status change plus internal note.

### Out of Scope
- "Respondido" and any reply channel; screenshot attachment; usage metrics; per-role guides.
- `pantalla` (never reaches the shell).
- Any change to customer `portal-sync` behavior.

## Capabilities

### New Capabilities
- `feedback`: workshop entry point, dialog, context capture, persistence, outbox forwarding and retry, "Mis comentarios".
- `support-inbox`: portal developer login, inbox, filters, delay flag, read/status/note lifecycle.

### Modified Capabilities
- `customer-portal`: the ingest requirements ("Ingest Payload Is Validated Against the Whitelist") accept a second, whitelisted `feedback` body kind, with an idempotent insert. Authentication is unchanged.
- `app-sidebar`: the footer gains the "Enviar comentario" item.

`portal-sync` is not modified: feedback only reuses its transport.

## Approach

Approach A from `explore.md`. Migration 0037 (workshop) and portal 0002 are additive. New Action `feedback.send` in all four role maps of `policy.ts`, plus a `ROUTE_GUARDS` entry. Stateless HMAC session via `node:crypto`; no new dependency.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/modules/feedback/` (new), `src/shared/db/schema.ts`, `drizzle/0037_*` | New/Modified |
| `src/modules/auth/policy.ts`, `route-guards.test.ts` | Modified |
| `src/components/app-sidebar.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/account/page.tsx` | Modified |
| `portal/src/contract.ts`, `portal/src/ingest/{parse,apply}.ts` | Modified |
| `portal/app/support/**`, portal schema + `0002`, `portal/src/env-isolation.test.ts` | New/Modified |

## Work Units (chained PRs, ≤400 lines each)

| WU | Content | Est. |
|----|---------|------|
| 1 | Workshop table, service, policy, POST route | ~350 |
| 2 | Contract + portal ingest + portal 0002 | ~350 |
| 3 | Inline send, per-row job, sweeper (+ e2e row) | ~350 |
| 4 | Provider, dialog, sidebar item, context map, toast | ~400 |
| 5 | "Mis comentarios" card | ~200 |
| 6 | Portal login + session + throttle | ~350 |
| 7 | Portal inbox list + filters + delay flag | ~350 |
| 8 | Portal detail: mark read, status, note | ~300 |

## Owner / Manual Steps

1. Set the portal env vars in Vercel: a support password and a session secret (names fixed in design).
2. Apply portal migration 0002 by hand: `cd portal && npx drizzle-kit migrate`.
3. Deploy the portal with the Vercel CLI from `portal/`, before the workshop forwarding (WU3) runs in production.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shared contract breaks the customer sync | Med | `contract-import.test.ts` and `portal/src/contract.test.ts` stay green |
| Workshop forwards before the portal accepts the kind (400) | Med | 4xx leaves the row queued; deploy order in manual steps |
| Retry storm after a long outage | Low | `localConcurrency: 1`, batched sweeper |
| Brute force on the support login | Med | DB-backed throttle, `timingSafeEqual` |
| Sweeper SQL, RSC boundary, 44px, LAN IP invisible to tests | High | e2e row, browser check at the LAN IP |

## Rollback Plan

Revert PRs in reverse order. Both migrations are additive; tables can stay. Queued rows wait harmlessly. Unsetting `PORTAL_INGEST_*` stops forwarding but also stops the customer sync, so prefer a revert. Removing the support env vars locks the inbox.

## Success Criteria

- [ ] A comment sent offline shows "Pendiente de envío", then flips to "Enviado" after reconnection, with no duplicate in the portal.
- [ ] The inbox shows username, role, context and the delay flag; it is unreachable without the login.
- [ ] Customer portal sync and its tests are unchanged.

## Proposal question round (assumptions for owner review)

1. The inline send uses a short timeout (≈5 s, not the transport's 15 s), so the dialog does not hang offline.
2. Opening "Mis comentarios" shows rows newest-first, with no pagination in v1.
3. A single shared support password (no per-developer accounts).
4. The internal note is one editable field, not a thread.
5. "Mis comentarios" reuses the same dialog to send a new comment.
