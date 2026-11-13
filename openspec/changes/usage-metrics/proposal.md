# Proposal: Usage Metrics

## Intent

The developer supports the workshop from home and cannot see which screens are used, by whom (as a group), or which are never opened. That makes it hard to prioritize work and to write the per-role guides that come next. Count screen views anonymously in the workshop and show the counts to the developer in the portal's support area, beside the feedback inbox.

Decisions: owner grill 2026-11-09 (Engram `feedback-metrics-guide-plan`). Second of three changes: feedback (shipped) → **metrics** → guides. Source of truth for layout and copy: `mockup/index.html`, once the owner approves it. Nothing is built before that.

**Naming:** this is NOT `metrics-dashboard` (`/metrics`, `metrics.read`: workshop productivity per technician). That change is archived and untouched. This change is called `usage-metrics`, and nothing in the workshop UI uses the word "métricas" for it.

**Owner decisions (2026-11-13):**
- Mockup approved.
- Palette **Opción B** for the whole support area: Comentarios and Uso, never the customer portal `/c`. It is 60% `#121417`, 30% `#D9DCE1` and 10% the workshop red `--urgent` (`hsl(0 72% 51%)`). The red never carries text: it measures 3.82:1 on `#121417`.
- Defaults the owner did not change:
  - missing days are hatched and do not count as zero;
  - a zero in one group shows in the table but not in "Sin visitas";
  - the stale-data notice appears when the newest data is more than one day old.
- Assumption, not confirmed: support is dark-only. The palette is dark-dominant, and the derived light variant was marked "a decidir".

## Scope

### In Scope
- **What is counted:** one view per screen render in the `(app)` shell, keyed by **screen** (a route pattern such as `/service-orders/[id]`, never the concrete URL, so no id, plate or customer name leaves the workshop), **role group** and **day** (workshop local date).
- **Role groups:** `gestión` (administrador + jefe_taller, merged because each is one person) and `técnico`. `pantalla` (the wall display) is excluded: it never reaches the shell.
- **Anonymity:** no user id, username, session, IP, timestamp finer than the day, or URL parameter is stored or sent. Only `(day, screen, group, count)`.
- **Storage (workshop):** a daily aggregate table, upsert-increment per view. No per-view rows.
- **Delivery:** a recurring job sends the full counts of every day since the last day the portal acknowledged (a watermark, not an outbox) up to the open day, to the portal's existing HMAC ingest as a new body kind. Each batch declares the day range it covers, empty days included, so the portal can tell "zero views" from "not arrived yet". The portal **replaces** the counts per `(day, screen, group)` inside that range. Resending is idempotent, and an outage of any length is caught up by the next successful run. Reuses `sendToPortal` and the secret.
- **Portal page:** `/support/uso`, behind the existing support login. Totals per screen and group for a chosen range (7 / 30 / 90 days), a daily trend, and the screens with zero views in the range. Read-only.
- **Screen labels:** reuse the route-to-label map from the feedback change (`src/modules/feedback/screen-labels.ts`), so the dialog and this page name screens the same way. The workshop sends its screen catalog (pattern + label) with each batch, so "Sin visitas" lists the screens the workshop's RUNNING version has, not the ones the last portal deploy knew about (the workshop PC often runs behind `main`).
- **Single-person screens:** some screens are open to only one role inside `gestión` (e.g. `/users`: `users.manage` is administrador-only). There, "Gestión" is one person. Decided in design with the owner: show them, or hide their per-group split.

### Out of Scope
- Per-user or per-person anything, session length, click tracking, funnels, time-on-screen.
- A workshop-side view of these counts (the owner sees `/metrics` for productivity; this is support-only).
- The per-role guides (the next change).
- Sending to any third party (PostHog, Sentry, analytics SaaS).
- API route calls: only screen renders count.

## Capabilities

### New Capabilities
- `usage-metrics`: workshop counting, daily aggregation, delivery to the portal, and the portal's read-only usage page.

### Modified Capabilities
- `support-inbox`: the support area gets a second section ("Uso") beside the inbox; same login and session.

## Approach

Count each pathname change on the client and record it on the server, which takes the role group from the session (design D1, D2). Ship the counts as absolute daily totals, so delivery is a stateless "send the last N days" job and the portal stores the last value it received.

## Affected Areas

| Area | Impact |
|---|---|
| `src/shared/db/schema.ts` + migration | New daily aggregate table |
| `src/modules/usage/` (new) | Count, aggregate, deliver job |
| `src/modules/feedback/` | Screen-label map reused; sent as the screen catalog with each batch (no behavior change) |
| `portal/src/contract.ts` | New ingest body kind |
| `portal/app/api/ingest` | Handle the new kind (replace per key) |
| `portal/src/db/schema.ts` + migration | Portal daily usage table |
| `portal/app/support/` | Support nav + `/support/uso` page |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A count leaks identity (a group of one) | Med | Fixed groups `gestión` / `técnico`; no per-user key exists in either database |
| Counting slows every page | Low | One upsert, off the render's critical path; failures swallowed and reported to Sentry without content |
| Prefetches, refreshes or polling inflate counts | High | The proxy matcher catches `/api/*` (the kanban polls `/api/kanban`) and RSC refreshes (`usePollWhileActive` calls `router.refresh()` on an interval), so proxy- or page-level counting would record them. Count pathname changes on the client instead; pinned by a test |
| "Sin visitas" wrong across versions | Med | The workshop sends its own screen catalog with each batch |
| Portal ingest contract change breaks the running workshop | Low | New body kind is additive; old workshop builds never send it |
| Migration on the workshop PC | Low | Additive table only; applied by the usual update (`standalone.ps1`) |

## Rollback Plan

Revert the PRs. The aggregate table and the portal table are additive and can stay or be dropped; nothing else reads them.

## Open questions (for design, not for the owner)

Resolved in `design.md`: count pathname changes on the client; deliver hourly; the day is the America/Panama date computed in SQL.

## Success Criteria

- [ ] The developer sees, from home, views per screen and group for the last 30 days, and which screens had none.
- [ ] Neither database contains a user id, username or URL parameter tied to a view.
- [ ] A day offline is caught up by the next successful run, with no duplicated counts.
