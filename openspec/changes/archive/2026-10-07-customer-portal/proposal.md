# Proposal: Customer Portal

## Intent

Round-2 step 4 (owner grill 2026-10-03, decisions final). Customers have no way to see where their vehicle is, or what was found and recommended, without calling the workshop. The printed order sheet already reserves a blank 25 mm QR slot (`service-order-reception`). This change fills it: the customer scans the QR with a phone and sees the status and history of their orders, served from a separate cloud app. The workshop server is never reachable from the internet.

## Scope

### In Scope
- **Ley 81/2019 consent, once per customer**: a checkbox on the customer record ("Consentimiento de datos (Ley 81)") that stores who, when, and which clause version. Revoking it is a new row, not a delete. No consent means no token, no QR, and no data in the cloud.
- **Portal token** per consented customer: 256 random bits from `node:crypto` on the server, base64url, never derived from an id. The administrator can rotate it ("Generar nuevo código", which kills every QR already printed). Revocation deletes it.
- **Printed sheet**: QR in the reserved slot plus a security notice ("Este código da acceso a tu historial. No lo compartas."). The provisional consent clause and a "Firma del cliente" line are added. The QR prints only when the customer has consented AND `PORTAL_BASE_URL` is set AND the sync is configured (`PORTAL_INGEST_URL` and `PORTAL_INGEST_SECRET` both present).
- **Outbound sync**: pg-boss jobs push signed snapshots to the portal. Revocation, rotation and customer deactivation push a delete. A nightly job re-pushes everything.
- **Portal app**, phone-first: a terms gate first. Nothing is shown, not even a plate, until "Acepto" is pressed. Then the history for all of the customer's vehicles. Every legal text carries the banner "TEXTO PROVISORIO — pendiente de revisión legal".
- Everything can be built and tested locally: the portal runs on `:3001` against a `portal` database in the existing Docker Postgres.

### Out of Scope
- Photos (see the data table), WhatsApp/Kapso, login, phone-number access, PINs, prices.
- The final legal text, which comes from a Panamanian lawyer and only replaces the provisional text.

## Data copied (whitelist; anything not listed never leaves)

| Copied | Why |
|---|---|
| order id | Matches "N.º" on the customer's sheet |
| customer-facing status: `open`→"Recibida", `in_progress`/`ready_for_review`→"En proceso", `done`→"Terminada", `cancelled`→"Cancelada" | The core need. Mapped in the workshop, so internal review states never leave |
| `categoria`, `created_at`, `appointment_at`, `completed_at` | What the work was and when |
| `description`, `hallazgos`, `recomendaciones` | The main value for the customer. Staff UI marks these three "Visible para el cliente" |
| vehicle id, `plate`, `make`, `model`, `year` | Lets the customer tell their cars apart |

Never copied: customer name, phone, email, cédula, opt-outs; `chasis`, colours, `placa_renovacion_mes`, `placa_municipio`, `seguro_vence`; `observaciones`; intake readings; technician names; work lines and minutes; corrections; `created_by`; photos. Photos are excluded because the customer already has them on the printed sheet (pages 2 and up), and copying them would mean either pushing large uploads over the workshop's internet line or giving the cloud read access to the whole R2 bucket. Adding them later means pushing bytes to storage the portal owns, never sharing R2.

## Capabilities

### New Capabilities
- `customer-portal`: the portal app, its ingest contract, terms gate and history view.
- `portal-sync`: the workshop's outbound jobs, the payload whitelist, revocation, and the nightly reconcile.

### Modified Capabilities
- `customer-management`: the Ley 81 consent record and the portal token lifecycle (issue, rotate, revoke).
- `service-orders`: Printable Work Order gains the QR, the security notice, the clause and the customer signature. Order fields show a "visible to customer" hint.

## Approach

| Decision | Recommendation | Tradeoff |
|---|---|---|
| Code location | `portal/` in this repo, as its own Next app with its own `package.json` (no workspaces). The Vercel Root Directory is `portal`. The wire contract is one dependency-free file there, imported by the workshop. Root `tsconfig`, `vitest` and `eslint` exclude `portal/`. | One contract with no drift, and GGA and AGENTS.md cover it for free. The cost is a second `npm install` and separate test commands. A separate repo would duplicate the contract, GGA and conventions. |
| Cloud store | Postgres on Neon (Vercel Marketplace). Drizzle, with one table `portal_customer(cliente_id pk, token_hash unique, snapshot jsonb, version, synced_at)` and one for terms acceptance. | Same tools as the workshop, and it runs locally. KV has no local equivalent and makes the acceptance log awkward. |
| Sync | Per-customer full snapshot. The job payload is `{clienteId}`, and the worker rebuilds the snapshot when it runs (same pattern as `runReminder`). If there is no consent or the customer is deactivated, it sends a DELETE. Requests go over HTTPS with HMAC-SHA256 on `timestamp.body` and a 5-minute skew window. The portal upserts only when `version` is newer. Retries with backoff, then a dead-letter queue (DLQ). Nightly reconcile. | Idempotent, needs no per-entity deletes, and a missed trigger heals overnight. Snapshots are small: about 384 customers with a few orders each. The workshop holds only `PORTAL_INGEST_URL` and `PORTAL_INGEST_SECRET`, with **no cloud database credentials**. |
| Token at rest | The workshop stores the token, because it reprints it. The portal stores only its SHA-256. | A leak of the portal database yields no usable QR. |
| Offline | Jobs queue and retry, and the nightly reconcile catches up. The portal shows "Actualizado: {fecha}". | Staleness is visible, never silent. |
| Portal hardening | `noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. The QR encodes `<PORTAL_BASE_URL>/c#<token>`; a client component strips the fragment and POSTs the token to `/api/c/*`, so the token is never in a server-visible URL. Acceptance is recorded server-side per token hash + terms version (no cookie). | Shared phones: holding the paper is the key, as the owner decided. The portal needs JavaScript. |

The QR encoder is new dependency `qrcode`, rendered as SVG on the server. The print page needs no secure-context API.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/db/schema.ts`, migrations | New | Consent table, token column |
| `src/modules/customers/`, customer detail UI | Modified | Consent checkbox, rotate, revoke |
| `src/modules/portal-sync/` | New | Snapshot builder, signer, jobs |
| `src/modules/service-orders/service.ts` | Modified | Trigger sync after each change |
| `src/app/(app)/service-orders/[id]/print/page.tsx` | Modified | QR, notice, clause, signature |
| `portal/` | New | Portal app, ingest route, schema |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Clause and customer signature push the sheet's signature to page 2 (about 240 px of slack today) | High | Check the print preview at the LAN IP |
| Domain changes after QRs are printed | Med | Fix the final domain before go-live, or keep the old one redirecting |
| Free-text findings contain remarks meant only for staff | Med | "Visible para el cliente" hint on those fields |
| Cross-border transfer (US region) under Ley 81 | Med | The lawyer's clause must cover it; the region is recorded |
| A mutation path forgets to trigger a sync | Med | Nightly reconcile, plus an e2e test per trigger |

## Rollback Plan

Unset `PORTAL_BASE_URL` and the secret: QRs stop printing and jobs stop sending. Delete the Vercel project and the Neon database to wipe the cloud copy. Revert the PRs in reverse order. The migrations are additive.

## Dependencies (owner-provided; everything else builds locally)

- Vercel account and plan. **Free vs Pro is pending**, and Hobby's terms may exclude commercial use, which needs verifying.
- A Neon/Postgres database (`DATABASE_URL`, which stays inside the portal).
- The final domain, because printed QRs embed it.
- `PORTAL_INGEST_SECRET`, generated once and set on both sides.
- The lawyer's legal text, which replaces the provisional text in a later PR.

## Delivery Estimate

Sixteen chained PRs of at most 400 lines each (see `tasks.md`):
1. Consent table and UI (WU1).
2a. Token and rotation (WU2a). 2b. QR and both print copies (WU2b).
3. Portal scaffold, schema and local dev.
4. Ingest endpoint with HMAC and version checks, plus e2e.
5a. Snapshot builder and worker. 5b. Triggers, reconcile and hints.
6a. Portal API (`/api/c/*`), neutral response, rate limit. 6b. Static shell, terms gate and history UI.
7. End-to-end local sync test, phone-width Playwright, runbook. Production deployment is blocked on the owner and tracked separately.

## Proposal question round

The owner was not reachable from this phase. The working assumption is listed after each question.
1. Who keeps the signed sheet? If the workshop keeps it, how does the customer get the QR? Assumed: a second "Copia del cliente" print without the signature block.
2. At the counter: staff ticks the checkbox, prints, the customer signs, and a refusal revokes consent. Assumed: yes.
3. A deactivated customer is removed from the portal and restored on reactivation. Assumed: yes.
4. Administrador and jefe de taller record consent; only the administrador rotates the token. Assumed: yes.

## Success Criteria

- [ ] A customer without consent has no QR, and no row exists in the portal database.
- [ ] Scanning shows nothing before "Acepto", then every order and vehicle of that customer only.
- [ ] Revocation and rotation make the old QR return nothing within one sync.
- [ ] A payload capture contains only whitelisted fields (contract test).
- [ ] With the workshop offline, the portal catches up after reconnecting. The sheet stays one page when there are no photos.
