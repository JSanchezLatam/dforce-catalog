# Dforce customer portal

Separate Next app (Vercel + Neon in production). It receives HMAC-signed
snapshots from the workshop and stores only `sha256(token)`. Design:
`openspec/changes/customer-portal/design.md`.

## Local dev (portal on :3001, workshop on :3000)

1. Create the database once: `docker exec dforce-catalog-db-1 createdb -U dforce dforce_portal`
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
