# Dforce Car — Catalog Generation System

Internal tool for Dforce Car staff to sync inventory from the Interfuerza
API, browse/filter it, and generate branded PDF catalogs from a selected
subset of products. Self-hosted (not serverless): one long-lived Next.js
process runs the web app, the background job workers, and the weekly sync
schedule.

Full requirements/design live under `.kiro/specs/dforce-catalog/` and in the
SDD spec/design artifacts (`sdd/dforce-catalog/*`) this build was generated
from.

## Running locally (Docker)

1. Copy the env template and fill in real values:
   ```
   cp env.example .env
   ```
   At minimum, `DATABASE_URL`/`POSTGRES_*` need to stay in sync (the compose
   file already wires `POSTGRES_*` into `DATABASE_URL` for the `app`
   service). `IFX_TOKEN`/`IFX_BASE_URL` are only needed once you run a real
   inventory sync; `R2_*` are only needed once you actually generate a
   catalog (PDFs are stored in Cloudflare R2, never on local disk — see
   `src/shared/config/env.ts` for what each variable does and its secrecy
   requirements).

2. Build and start the app + Postgres:
   ```
   docker compose up --build
   ```
   The app runs on `http://localhost:3000`. Postgres is the only stateful
   dependency — pg-boss's queue schema and the app's own tables both live
   in that one database.

3. Run migrations (first boot, and after pulling schema changes):
   ```
   docker compose exec app npx drizzle-kit migrate
   ```
   (Or `npm run db:migrate` if you're running the app outside Docker with
   `DATABASE_URL` pointed at a reachable Postgres.)

4. Create at least one user. There is no seed script yet — insert directly,
   e.g. via `docker compose exec db psql -U dforce -d dforce_catalog` and a
   manual `INSERT INTO users ...` with a bcrypt hash (cost ≥ 12), or a short
   one-off Node script calling `hashPassword()` from
   `src/modules/auth/password.ts`. Log in at `/login`.

### Running without Docker

`npm install`, set `DATABASE_URL` to a reachable Postgres, `npm run
db:migrate`, then `npm run dev`. Playwright's Chromium (used to render
PDFs) must be installed once via `npx playwright install chromium` — the
Docker image already bundles it (see `Dockerfile`'s `runner` stage, built
`FROM mcr.microsoft.com/playwright:...`).

## Tests

- `npm run test` — unit tests (Vitest). Fast, no external services; DB/queue
  calls are faked or dependency-injected.
- `npm run test:e2e` — full-flow E2E (`src/e2e/full-flow.e2e.test.ts`):
  login → sync inventory → filter/view → configure template → build a
  selection → enqueue → real pg-boss processing + a real Chromium PDF
  render → uploaded → preview/download, plus 401/403 gating. Needs a REAL,
  disposable Postgres (never point it at your dev database — it inserts
  test users/products/catalogs):
  ```
  docker run -d --name dforce-e2e-pg -e POSTGRES_USER=dforce \
    -e POSTGRES_PASSWORD=dforce -e POSTGRES_DB=dforce_catalog \
    -p 55432:5432 postgres:17-alpine

  DATABASE_URL=postgres://dforce:dforce@localhost:55432/dforce_catalog \
    npm run test:e2e

  docker rm -f dforce-e2e-pg
  ```
  The only two things this suite mocks are the Interfuerza API and
  Cloudflare R2 — both genuinely external network services; everything
  else (Postgres, pg-boss, bcrypt/sessions, the Chromium render) runs for
  real.

## Architecture overview

Next.js App Router, self-hosted with `output: "standalone"` (see
`next.config.ts`). `src/app/**` route handlers and pages are thin and
delegate to `src/modules/*`; each module owns its own DB access. Background
work (weekly inventory sync, PDF generation, PDF upload) runs as pg-boss
jobs registered once at server startup via `src/instrumentation.ts`.

| Module (`src/modules/*`) | Responsibility |
|---|---|
| `auth` | DB-backed sessions, bcrypt password hashing, the `can(user, action)` policy seam |
| `inventory-sync` | Interfuerza API client (rate-limited, retrying), round-trip mapper, the weekly/manual sync job |
| `inventory-view` | Filtered, paginated read model for browsing inventory |
| `template-config` | Persisted catalog branding (logo, colors, font, cover text) with live preview |
| `catalog-builder` | Category/product selection, exclusion, 200-product cap, live title/index preview |
| `pdf-generation` | Bounded job queue (1 active + 2 waiting), Chromium-rendered PDF, queue-position adapter |
| `catalog-storage` | Cloudflare R2 adapter, `upload_status` state machine, per-user retention (max 2 catalogs) |
| `shared/db`, `shared/jobs`, `shared/config`, `shared/template` | Drizzle schema/client, pg-boss bootstrap, env access, the ONE template component shared by the live preview and the real PDF render |

Route protection is a single blanket guard (`src/proxy.ts`, Next's renamed
`middleware`): every route except `/login` and `/api/login` requires a
valid session, forwarded downstream as `x-user-id`/`x-user-role` headers so
route handlers can call `requireSession()` + `can()` without a second DB
round-trip.

Background jobs (`inventory-sync`, `pdf-generate`, `pdf-upload`) start once
at server boot via `src/instrumentation.ts` — confirmed by actually running
`node .next/standalone/server.js` (`next start` doesn't work with
`output: "standalone"`), not just `next build`. That check caught a real
gap: Next's standalone file tracer doesn't pick up `playwright-core`'s own
`browsers.json` manifest (it's read outside normal `import`/`require`
analysis), so the first build that ever imported `playwright` from the
server bundle crashed at boot. Fixed via `outputFileTracingIncludes` in
`next.config.ts` — see that file's comment if this ever needs adjusting for
a Playwright version bump.

### Known gaps (carried forward, not blocking)

- No admin UI to trigger a manual inventory sync yet (`requestManualSync()`
  exists and is tested, but nothing calls it from `src/app/**`).
- "Regenerate" from the catalog listing links back to `/builder` rather
  than automatically replaying the original selection (only a display-only
  category snapshot is persisted, not the full product selection).
- A missing/evicted PDF shows a plain JSON 404 body rather than a styled
  in-app message.
