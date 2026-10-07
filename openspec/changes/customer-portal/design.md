# Design: Customer Portal

## Technical Approach

Two apps, one repo, one wire contract. The workshop (LAN, never reachable from the internet) owns consent, the token and the truth; it pushes HMAC-signed, whitelisted, per-customer snapshots through pg-boss to `portal/`, a second Next app on Vercel + Neon that stores only `sha256(token)` and renders a phone-first page behind a terms gate. The payload carries the token HASH, never the token: the raw token leaves the LAN only on paper. Accepted v1 decisions: the workshop keeps the signed sheet and the customer takes a "Copia del cliente" with the QR; the counter flow is tick consent → print → sign, and a refusal revokes; deactivation removes the customer from the portal and reactivation restores the same QR; admin and jefe de taller record consent, and only the admin rotates the code.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Repo layout | `portal/` with its own `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `vitest.e2e.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`, `.gitignore` (`node_modules`, `.next`, `.env*.local`; the root entries are anchored `/node_modules` and `/.next`, so they do NOT cover it). Vercel Root Directory `portal`. | npm workspaces; separate repo | Workspaces would hoist and re-resolve the workshop's pinned tree (pg-boss, Next 16.2.11) for no gain. A separate repo duplicates the contract, AGENTS.md and GGA. |
| Root isolation | Root `tsconfig.json` `exclude: ["node_modules", "portal"]`; root `vitest.config.ts` adds `"portal/**"` to the top-level AND both project excludes; `vitest.e2e.config.ts` include is already `src/e2e/**`; root `eslint.config.mjs` `globalIgnores` adds `"portal/**"`; `.dockerignore` adds `portal/`. Portal `tsconfig` `include` covers only its own tree. | Leave the root globs alone | Root `include` is `**/*.ts` and vitest's default include is `**/*.test.ts`, so both would otherwise compile and run portal files against the wrong `node_modules`. |
| Commands | Root `npm test` / `npx tsc --noEmit` / `npm run lint` (0 errors, 13 warnings) stay workshop-only. Portal: `cd portal && npm test && npx tsc --noEmit && npm run lint`. The pre-PR gate for any WU touching `portal/` is all six. | Chaining portal into root `npm test` | Keeps the root suite infra-free and the timeout/worker measurements in `vitest.config.ts` valid. |
| GGA | No `.gga` change: `FILE_PATTERNS` is extension-based and `RULES_FILE=AGENTS.md` applies repo-wide, so `portal/**` is reviewed for free. AGENTS.md gains one bullet: "`portal/` is a separate Next app, with its own install and gate commands." | `portal/.gga` | One reviewer and one rule set. |
| Wire contract | `portal/src/contract.ts`: types, header names, `MAX_SKEW_SECONDS = 300`, and `sign()` / `verify()` built on `node:crypto` (`createHmac`, `timingSafeEqual`), with no imports besides `node:crypto`. The workshop imports it through the alias `@portal/contract` → `./portal/src/contract.ts`, declared in root `tsconfig` `paths` and root vitest `resolve.alias`. | Copying it into both apps; a published package | TS `exclude` does not stop an IMPORTED file from being type-checked, so the root tsc checks exactly that one file. Vercel builds from `portal/`, so the file must live there. Both sides run the same signing code, so they cannot drift. Server-only by convention: never imported from a `"use client"` file. |
| Token at rest (workshop) | **Plaintext** column `cliente.portal_token text UNIQUE NULL`, generated as `randomBytes(32).toString("base64url")` on the server. | Encrypted at rest; regenerated per print | Regenerating on each reprint kills every earlier QR. Encryption would put the key in the same `.env` on the same machine as the DB, and the token unlocks only data that DB already holds in full, so it adds key management and protects nothing. |
| Consent | Append-only `cliente_consentimiento(id, cliente_id FK cascade, granted bool, clause_version text, recorded_by FK users set null, recorded_at)`, index `(cliente_id, recorded_at desc)`. The current state is the latest row. Granting issues a token if none exists; revoking sets `portal_token = NULL`. Both happen in one transaction. New actions `customers.consent` (administrador, jefe_taller) and `customers.portalRotate` (administrador). | A boolean on `cliente` | Ley 81 needs who, when and which clause. |
| Portal DB | Drizzle 0.45.2 + `pg` (node-postgres) on Neon's **pooled** URL. | `@neondatabase/serverless`; KV | The same driver runs against the local docker Postgres and Neon. The Neon driver's websocket path has no local equivalent. |
| Ordering | Workshop sequence `portal_sync_version_seq`. The worker holds `pg_advisory_xact_lock(hashtext('portal-sync:'||id))` across read → `nextval` → POST. node-postgres returns a `bigint` as a STRING, so the value is `Number()`-ed explicitly. | `Date.now()`; pg-boss singleton policy | Without the lock, job A can read old data and draw a higher version than job B, which read newer data, so the stale snapshot would win. Clocks are not monotonic. |
| Delete = tombstone | Upsert and delete are ONE statement: `INSERT … ON CONFLICT (cliente_id) DO UPDATE … WHERE portal_customer.version < excluded.version`. A delete writes `token_hash = NULL, snapshot = NULL`. | Hard `DELETE` | After a hard delete, a replayed or reordered older upsert recreates the row. The tombstone holds only an opaque id and a version and serves no data; the nightly reconcile purges it. Specs say "no data is served for that hash". |
| Replay safety | Timestamp within ±300 s, a constant-time signature check over `${ts}.${rawBody}`, and the version compare above, which makes any replay a no-op. | Nonce table | The version already makes a replay idempotent, so a nonce adds a table and changes nothing. |
| Token transport | **The token never sits in a URL the server sees.** The QR encodes `<PORTAL_BASE_URL>/c#<token>`. `/c` is a static shell with no customer data. A client component reads `location.hash`, immediately calls `history.replaceState(null, "", "/c")` to strip it, and POSTs the token in the JSON body to `POST /api/c/open` (terms status), `POST /api/c/accept` (records acceptance, returns the snapshot) and `POST /api/c/snapshot` (snapshot only if accepted). No token in query strings, cookies, redirects or logs. Every response is `Cache-Control: no-store`. | Token in the path `/c/<token>` (Vercel request logs would record it); a cookie | The fragment is never sent to any server, proxy or log. The cost is that the portal needs JavaScript. The terms text lives in the static shell, so nothing customer-derived is in the shell. |
| Terms gate | Acceptance is recorded **server-side** per token hash + terms version in `portal_terms_acceptance(token_hash, terms_version, accepted_at)`; `open` and `snapshot` consult it. No cookie, no IP or user agent stored (minimization). Acceptance therefore follows the token, not the device: holding the paper is the key, as the owner decided. | A path-scoped cookie; a server-side session | No cookie means nothing to scope, no `Secure` flag trap over LAN HTTP, and a new `TERMS_VERSION` re-gates automatically. |
| Neutral response | An invalid, unknown, revoked, rotated or tombstoned token gets ONE response from all three API routes: HTTP 404, body `{"state":"invalid"}`, same headers, one indexed lookup of `sha256(token)` and no branching on why. | Distinct errors per cause | No oracle for enumeration or for "this customer exists". |
| Open-endpoint rate limit | Per-IP counter on all three `/api/c/*` routes (client IP from `x-forwarded-for` first hop): 30 requests / 60 s, then 429. In memory. `// ponytail:` per serverless instance, so it is best-effort and resets on cold start; upgrade to Vercel Firewall rules or a DB counter if abuse appears. 256-bit tokens make guessing infeasible, so this limits noise and DB load only. | No limit; DB-backed counter | Cheapest guard that fits a serverless host. |
| Copies | `print/page.tsx?copia=cliente` adds the QR, the security notice and the clause, and omits the signature block. The default (workshop) copy adds the clause and "Firma del cliente", and **no QR**. | A QR on both copies | The archived paper should not carry a live credential. |

## Data Flow

```
mutation (service.ts) ──commit──▶ enqueuePortalSync(clienteId)   (after commit; errors captured, never thrown)
                                     │ pg-boss `portal-sync` {clienteId}
                                     ▼
worker: tx{ advisory lock → buildSnapshot → nextval } → sign → POST PORTAL_INGEST_URL
                                     │ retry 5, 60 s backoff → `portal-sync-dlq`
nightly `portal-reconcile` (0 8 * * * UTC = 03:00 Panamá): enqueue every live id, then POST {reconcile}
                                     ▼
portal /api/ingest: verify → parse → one upsert/tombstone SQL │ reconcile: delete rows not in live set AND version < maxVersion
phone: QR → /c#<token> (static shell) → client strips hash → POST /api/c/open {token} → sha256 → row? → accepted for TERMS_VERSION?
       no → terms → POST /api/c/accept {token} → insert acceptance → snapshot  |  yes → POST /api/c/snapshot {token} → snapshot
```

Sync is "live" when the customer is active, has a latest consent row with `granted`, and has a token. Anything else sends a delete. When `PORTAL_INGEST_URL` or `PORTAL_INGEST_SECRET` is unset, enqueueing is a no-op, and the next reconcile catches up. The ingest URL must be `https:` unless the host is `localhost` or `127.0.0.1`. Triggers fire from `createOrder`, `updateOrder` (corrections included), `transitionOrder`, `updateCliente` (vehicle plan), `deactivateCliente`, `reactivateCliente`, consent grant and revoke, and rotate. `applyReadiness` needs no trigger: it only flips `in_progress ↔ ready_for_review`, and both map to "En proceso".

## Interfaces / Contracts

```ts
// portal/src/contract.ts
export type PortalOrder = { id: string; status: "Recibida" | "En proceso" | "Terminada" | "Cancelada";
  categoria: string /* Spanish label, mapped in the workshop */; createdAt: string; appointmentAt: string | null;
  completedAt: string | null; description: string | null; hallazgos: string | null; recomendaciones: string | null };
export type PortalVehicle = { id: string; plate: string; make: string | null; model: string | null; year: number | null; orders: PortalOrder[] };
export type IngestBody =
  | { kind: "upsert"; clienteId: string; version: number; tokenHash: string; generatedAt: string; vehicles: PortalVehicle[] }
  | { kind: "delete"; clienteId: string; version: number }
  | { kind: "reconcile"; liveClienteIds: string[]; maxVersion: number };
// Headers: x-portal-timestamp (unix s), x-portal-signature (hex HMAC-SHA256 of `${ts}.${rawBody}`)
```

The vehicles sent are the active vehicles plus any vehicle that has orders. The portal tables are `portal_customer(cliente_id pk, token_hash text unique null, snapshot jsonb null, version bigint, synced_at timestamptz)` and `portal_terms_acceptance(id bigserial, token_hash, terms_version, accepted_at)`. The ingest route returns 401 for a bad signature or skew, 400 for a bad shape (hand-rolled validation, no new dependency), and 200 `{applied}`, with `runtime = "nodejs"`. Portal headers: `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/c` and `/api/c/:path*`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, plus `robots.ts` disallowing `/`. `/c` is a static shell (server component) wrapping one `"use client"` component that holds the only token handling; it receives no customer data as props. Portal API contract: `open` 200 `{state:"terms"}` or `{state:"accepted"}`; `accept` 200 `{state:"accepted",snapshot}`; `snapshot` 200 `{state:"accepted",snapshot}` when accepted, else 200 `{state:"terms"}`; any bad token 404 `{state:"invalid"}`; rate limit 429; malformed body 400. The client renders "Este enlace no es válido. Pedí uno nuevo en el taller." on `invalid`, and the same for a missing or empty fragment.

## File Changes

| Path | Action |
|---|---|
| `src/shared/db/migrations/0030_*` (consent), `0031_*` (token), `0032_*` (sequence); `schema.ts` | Create/Modify |
| `src/modules/customers/consent.ts`, `portal-token.ts`; customer detail UI; `auth/policy.ts` | Create/Modify |
| `src/modules/portal-sync/{snapshot,job,enqueue}.ts`; `instrumentation-node.ts`; `shared/config/env.ts` (+3 vars, the secret in `SENSITIVE_ENV_KEYS`) | Create/Modify |
| `src/modules/{service-orders,customers}/service.ts` (post-commit triggers, "Visible para el cliente" hints) | Modify |
| `src/app/(app)/service-orders/[id]/print/page.tsx`; dependency `qrcode` (SVG, server-side) | Modify |
| root `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `.dockerignore`, `AGENTS.md` | Modify |
| `portal/**` (app, `src/contract.ts`, `src/db/schema.ts`, `app/api/ingest/route.ts`, `app/api/c/{open,accept,snapshot}/route.ts`, `app/c/page.tsx` + `PortalClient.tsx`, `src/rate-limit.ts`) | Create |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (workshop) | Whitelist: a fixture with EVERY forbidden column populated, the snapshot's key set asserted by deep equality; status mapping; live vs delete decision; HTTPS guard | Root `npm test`, injected seams |
| Unit (portal) | `sign`/`verify`: tamper, skew at ±301 s, wrong secret, length mismatch; body parsing | `npm --prefix portal test` |
| E2E (workshop) | Consent and revoke rows, token issue/rotate/null, `nextval`, advisory lock serialization, one `pgboss.job` row per trigger | `src/e2e/portal-sync.e2e.test.ts`, throwaway DB |
| E2E (portal) | Version gate, tombstone, a replayed older upsert after a delete, the reconcile purge bound, the acceptance insert | `portal/e2e/*.e2e.test.ts` against `dforce_portal_test` |
| Local sync | Workshop job → portal ingest (`next start -p 3001`) → `POST /api/c/open|accept|snapshot` with the token: no plate before accept, plate after | `npm run test:portal-sync`, which FAILS (never skips) if :3001 is unreachable |
| Browser | Consent UI and the one-page print preview at the LAN IP; the QR from the "Copia del cliente" opens `/c#token` at a phone viewport (Playwright, 390 px) with the hash stripped from the address bar after load; a real phone at `http://<ip>:3001` | Playwright plus a manual check |

Every fix is mutation-verified. The SQL whose value lies in a `WHERE` (the version gate, reconcile, latest consent) has an e2e row, never only a seam test.

## Threat Matrix

N/A — no shell, subprocess, VCS automation or executable classification. The internet-facing boundary (ingest and token page) is covered by the decisions and RED tests above.

## Migration / Rollout

Migrations 0030–0032 are additive. Local dev: `docker compose exec db createdb -U dforce dforce_portal`, then portal `.env.local` `DATABASE_URL=…@localhost:5433/dforce_portal`, the same `PORTAL_INGEST_SECRET` on both sides, and in the workshop `.env` `PORTAL_INGEST_URL=http://localhost:3001/api/ingest` and `PORTAL_BASE_URL=http://<LAN-IP>:3001` (the QR encodes `<PORTAL_BASE_URL>/c#<token>`). The shared secret lives in the workshop `.env` and `portal/.env.local`; portal on :3001 and workshop on :3000 run together. Production items (Vercel, Neon, domain, secret, lawyer text) are owner-provided and tracked in `tasks.md` under "Deployment — blocked on owner". Rollback: unset `PORTAL_BASE_URL` and the secret.

| WU | Content | Base |
|---|---|---|
| 1 | 0030 consent, policy actions, consent UI + toast | tracker |
| 2 | 0031 token, rotate, `qrcode`, both print copies | 1 |
| 3 | Portal scaffold, root isolation, contract + unit tests, schema, local dev docs | 2 |
| 4 | Ingest route + portal e2e | 3 |
| 5a | 0032, snapshot builder, worker, lock, workshop e2e | 4 |
| 5b | Triggers, reconcile, field hints, `test:portal-sync` | 5a |
| 6a | `/api/c/{open,accept,snapshot}`, neutral response, rate limit, portal e2e | 5b |
| 6b | Static shell `/c`, client component, terms and history UI | 6a |
| 7 | `test:portal-sync` end-to-end local sync, Playwright at phone width, runbook | 6b |

## Open Questions

- [x] RESOLVED (orchestrator): the token never reaches a server-visible URL: `/c#<token>`, client strips the hash and POSTs the token (see Token transport). Terms acceptance is server-side per token hash + version; no cookie.
- [x] RESOLVED (orchestrator): a revoked customer keeps a data-free tombstone until the nightly reconcile. The specs now say "no data is served for that hash", not "no row exists".
- [ ] A second `next dev` on one machine was once rejected (Engram). Verify that portal :3001 (`next dev -p 3001`, its own `.next`) coexists with the workshop :3000. Task in WU3.
- [ ] Vercel Hobby is non-commercial per Vercel's terms: owner verifies before choosing a plan (Deployment section of `tasks.md`).
