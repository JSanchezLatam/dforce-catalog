# Dforce customer portal

Separate Next app (Vercel + Neon in production). It receives HMAC-signed
snapshots from the workshop and stores only `sha256(token)`. Design:
`openspec/changes/customer-portal/design.md`.

## Local dev (portal on :3001, workshop on :3000)

1. Create the database once: `docker compose exec db createdb -U dforce dforce_portal`
2. `cp .env.example .env.local` (`DATABASE_URL` points at `dforce_portal` on :5433).
3. `npm install && npx drizzle-kit migrate`
4. `npm run dev -- -p 3001`
5. Workshop `.env`, with the SAME secret as `portal/.env.local`:

   ```
   PORTAL_INGEST_URL=http://localhost:3001/api/ingest
   PORTAL_INGEST_SECRET=<same value as portal/.env.local>
   PORTAL_BASE_URL=http://<LAN-IP>:3001
   ```

## Gates

`npm test && npx tsc --noEmit && npm run lint`. `npm run test:e2e` needs a
reachable Postgres and runs against a throwaway `dforce_portal_test`, never
`dforce_portal`.

The root app excludes `portal/` from its own tsc/vitest/eslint; the only file
shared with the workshop is `src/contract.ts` (alias `@portal/contract`).

## End-to-end check (workshop job -> portal -> customer)

`npm run test:portal-sync`, from the REPO ROOT. It creates two throwaway
databases on the docker Postgres (`dforce_portalsync_workshop`,
`dforce_portalsync_portal`), migrates both, runs
`scripts/portal-sync/sync.local.ts` and drops them. It never touches
`dforce_catalog` or `dforce_portal`, and it FAILS (never skips) when Postgres is
unreachable (`PORTAL_SYNC_ADMIN_URL` overrides the default
`postgres://dforce:dforce@localhost:5433/postgres`).

It runs the real workshop job and signer against the portal's real route
handlers IN-PROCESS: `fetch` hands the signed request straight to the ingest
handler instead of a spawned `next dev`, so there is no port or boot race and
the code under test is the same function. It covers consent -> token -> push ->
`open`/`accept`/`snapshot`, an edit re-sync, rotate, revoke, re-grant,
deactivate/reactivate, a replayed stale body, the offline case (the job throws a
retryable error, user writes still succeed, the nightly reconcile heals) and no
outbound request without a secret. It does not cover the browser; do that by
hand at the LAN IP.

## Deploying (owner runbook)

1. **Vercel project.** Import the repo, set **Root Directory** to `portal`.
   Plan: Hobby is for non-commercial use under Vercel's terms and a workshop
   serving customers is commercial, so check the current terms and pick Pro if
   in doubt.
2. **Database.** Create a Neon Postgres. Put its POOLED connection string in the
   Vercel project as `DATABASE_URL` (portal project only; never in the workshop).
   Note the Neon region: the terms say the data is stored outside Panama.
3. **Migrate the portal DB** once, from `portal/`:
   `DATABASE_URL=<neon url> npx drizzle-kit migrate`. Repeat after any deploy
   that adds a migration.
4. **Shared secret.** Generate it once: `openssl rand -base64 32`. Set it as
   `PORTAL_INGEST_SECRET` in Vercel AND in the workshop `.env`. Both sides must
   match exactly.
5. **Domain, before any QR is printed.** Every printed "Copia del cliente"
   embeds `PORTAL_BASE_URL`. Fix the final domain first; if it must change later,
   keep the old one redirecting.
6. **Workshop `.env`** (restart the workshop after editing):
   ```
   PORTAL_BASE_URL=https://<final-domain>
   PORTAL_INGEST_URL=https://<final-domain>/api/ingest
   PORTAL_INGEST_SECRET=<the secret from step 4>
   ```
   `PORTAL_INGEST_URL` must be https (plain http is accepted only for
   `localhost`). With the secret or URL unset the sync is inert and no QR is offered.
7. **Check.** Give a test customer consent, scan the printed copy on a phone,
   accept the terms, and confirm only their own plates and orders appear.

**Legal text.** The consent clause and portal terms are provisional. Replacing
either with the lawyer's text needs a NEW version id (`CONSENT_CLAUSE_VERSION` in
`src/modules/customers/consent.ts`, `TERMS_VERSION` in `portal/src/terms.ts`).
Bumping the terms version makes every customer accept again, which is intended.

**Rollback.** Redeploy the previous deployment in Vercel (the workshop keeps
working: edits never wait for the portal). To switch the portal off entirely,
unset `PORTAL_INGEST_SECRET` in the workshop `.env` and restart; no request goes
out and no QR is offered. Migrations are additive; do not drop portal tables to
roll back. To take one customer offline, revoke their consent in the workshop;
the next sync removes their data and their QR answers 404.

**Do NOT**
- change `PORTAL_BASE_URL` after printing QRs without keeping the old domain redirecting;
- put the secret in a `NEXT_PUBLIC_*` variable;
- point the portal at the workshop database, or the workshop at the portal one;
- put a token in a URL query, a log line or a ticket: it lives only in the fragment (`/c#<token>`);
- run `test:portal-sync` or any e2e against `dforce_catalog` / `dforce_portal`;
- add a field to the snapshot without extending the whitelist in `portal/src/ingest/parse.ts` and its tests.
