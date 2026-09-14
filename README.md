# Dforce Car — Catalog Generation System

Internal tool for Dforce Car staff to sync inventory from the Interfuerza
API, browse/filter it, and generate branded PDF catalogs from a selected
subset of products. Self-hosted (not serverless): one long-lived Next.js
process runs the web app, the background job workers, and the weekly sync
schedule.

Full requirements/design live under `.kiro/specs/dforce-catalog/` and in the
SDD spec/design artifacts (`sdd/dforce-catalog/*`) this build was generated
from.

## Running locally (the short way)

```
./scripts/macos/dev.sh
```

Brings up Postgres in Docker, applies migrations, seeds a local administrator
when the `users` table is empty, and starts Next in dev mode on
`http://localhost:3000` — `admin` / `admin123` by default, overridable with
`DEV_USER` / `DEV_PASSWORD`. `APP_PORT` moves the port, `SKIP_TYPECHECK=1`
skips the `tsc` gate.

It orchestrates only: it never installs dependencies and never writes `.env`.
When a prerequisite is missing it prints what is wrong and the command that
fixes it, then exits non-zero.

To keep the database out of a Docker volume entirely, see **Running without
Docker** below. The long form that follows is what these scripts automate, and
what you want when running the production image rather than dev mode.

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

3. Run migrations (first boot, and after pulling schema changes). The `app`
   image is a stripped-down production build with no dev tooling, so
   migrations run against the `builder` stage instead (has drizzle-kit +
   source), via a dedicated compose service:
   ```
   docker compose --profile tools run --rm migrate
   ```
   (Or `npm run db:migrate` if you're running the app outside Docker with
   `DATABASE_URL` pointed at a reachable Postgres.)

4. Create at least one user:
   ```
   docker compose --profile tools run --rm migrate node scripts/seed-user.mjs admin "a-real-password" administrador
   ```
   (Runs against the `migrate` service's `builder`-stage image, since it has
   the full source — the `app` image doesn't. Outside Docker: `npm run
   db:seed-user -- admin "a-real-password" administrador`, with
   `DATABASE_URL` pointed at a reachable Postgres.) Role is `tecnico` or
   `administrador`; log in at `/login`.

### Running without Docker

```
./scripts/macos/standalone.sh
```

Runs the whole app against a Homebrew Postgres whose data lives in
`$(brew --prefix)/var/postgresql@17` — an ordinary folder — instead of the
`db-data` Docker volume, which `docker system prune` and `docker compose
down -v` delete without warning. It handles the move from an existing
container, backups and restores, and every step is idempotent: a failed run
is resumed by running it again. See [STANDALONE.md](STANDALONE.md) for the
subcommands (`backup`, `restore`, `status`) and the environment variables.

That script and everything under `scripts/macos/` is macOS-only (Homebrew,
launchd, bash). On Windows the equivalent scripts live in `scripts/windows/`
— see [WINDOWS.md](WINDOWS.md). The cross-platform Node entrypoints
(`scripts/migrate.mjs`, `scripts/seed-user.mjs`, `scripts/preview-catalog.ts`)
stay at `scripts/` and are called from both.

By hand instead: `npm install`, set `DATABASE_URL` to a reachable Postgres,
`npm run db:migrate`, then `npm run dev`. Playwright's Chromium (used to
render PDFs) must be installed once via `npx playwright install chromium` —
the Docker image already bundles it (see `Dockerfile`'s `runner` stage,
built `FROM mcr.microsoft.com/playwright:...`).

## Tests

- `npm run test` — unit and component tests (Vitest). No external services;
  DB/queue calls are faked or dependency-injected.

  One command, **two projects**: `node` for `*.test.ts` and `jsdom` for
  `*.test.tsx` (component and page tests). The jsdom project is capped at
  `maxWorkers: 2` with its own `sequence.groupOrder`, and that is load-bearing
  rather than tuning — a component test that opens a dialog and types into a
  controlled form re-renders on every keystroke, and enough of them in
  parallel starve each other past any `testTimeout` you pick. Measured: the
  uncapped suite failed 5 tests, then 1 different one; the same files run
  isolated pass 89/89; capped, the whole suite is green run after run. The
  `node` project keeps full parallelism. See `vitest.config.ts` for the
  numbers and `AGENTS.md` for how to read a red run.

  **Server components are testable, and there is no harness.** A page is an
  async function returning JSX, so `render(await Page({ params:
  Promise.resolve({...}) }))` runs it under jsdom with only the request-scoped
  and data edges mocked — see
  `src/app/(app)/customers/[id]/vehicles/[vehicleId]/page.test.tsx`.
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

  Without Docker, any local Postgres does — create the throwaway database and
  drop it afterwards. **Never reuse the dev database name**; this repo has two
  `dforce_catalog` databases on different ports and the whole point is that
  the e2e one is disposable:
  ```
  psql -d postgres -c 'CREATE DATABASE dforce_e2e'
  DATABASE_URL=postgres://$USER@localhost:5432/dforce_e2e npm run test:e2e
  psql -d postgres -c 'DROP DATABASE dforce_e2e'
  ```
  The only two things this suite mocks are the Interfuerza API and
  Cloudflare R2 — both genuinely external network services; everything
  else (Postgres, pg-boss, bcrypt/sessions, the Chromium render) runs for
  real.

  **Recreate the database on every run.** The catalog-generation block seeds
  `e2e-user`/`e2e-admin`/`e2e-other` and never cleans up, so a second run
  against the same database dies on `Key (username)=(e2e-user) already
  exists`. Known debt. The customer and vehicle blocks do clean up, and by
  captured id rather than by name, so a real row sharing a name is untouched.

  **This suite is not optional for database work.** Every unit test in
  `src/modules/*` injects its query seam, so a fully green `npm run test` is
  *evidence* that no test executed real SQL — see "Known coverage limit" in
  `AGENTS.md`. Three defects reached review invisible to the entire unit
  suite and only ever showed up here: a search predicate that matched nothing
  after a data migration, a correlated subquery that returned an empty array
  for every row because Drizzle elides table qualifiers inside a `.select()`
  field map, and a collection write that resurrected every soft-deleted row.

  Asserting the generated SQL text (`new PgDialect().sqlToQuery(...)`, as
  `customers/queries.test.ts` does) proves the *shape* of a `WHERE` fragment
  without a database. It does **not** prove a query returns the right rows,
  and it does not reproduce qualifier behaviour inside a `.select()` — that
  is how the second of those three got through.

## Architecture overview

Next.js App Router, self-hosted with `output: "standalone"` (see
`next.config.ts`). `src/app/**` route handlers and pages are thin and
delegate to `src/modules/*`; each module owns its own DB access. Background
work (weekly inventory sync, PDF generation, PDF upload) runs as pg-boss
jobs registered once at server startup via `src/instrumentation.ts`.

| Module (`src/modules/*`) | Responsibility |
|---|---|
| `auth` | DB-backed sessions, bcrypt password hashing, the `can(user, action)` policy seam |
| `account` | Admin user management: create/edit, forced password change, reversible deactivation via `deactivated_at` — the convention any other soft delete copies |
| `customers` | `cliente` CRUD, the `vehiculo` collection and its pure reconcile planner, per-vehicle validation, the accent-insensitive search shared by the list page and the order picker, and the per-vehicle service-history screen (`customers/[id]/vehicles/[vehicleId]`) |
| `service-orders` | Service orders against a customer **and exactly one of that customer's vehicles** (`vehiculo_id` is `NOT NULL`, `ON DELETE RESTRICT`), a five-value service category (Instalación, Mant. Preventivo, Mant. Correctivo, Reparación, REVISADO), completion notes recorded after the work (`hallazgos`/`recomendaciones`/`observaciones`, patch-only), status transitions, parts line-items with a price/name snapshot, and the async customer picker |
| `reminders` | Appointment and service-due reminders over WhatsApp/email, with per-channel opt-out re-checked at fire time, not schedule time |
| `workshop-config` | The workshop's own identity — name, contact, hours, socials, logo, cover image — as printed on the catalog |
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
- Customers cannot be deleted or deactivated from the UI. The database
  already refuses to delete a customer that has service orders
  (`onDelete: restrict`), but that safety net is never exposed to staff.
- There is no unique constraint on `cliente.phone`, deliberately. A census of
  the 364 Interfuerza customers found 9 repeated numbers across 18 records —
  and three of those groups are *different people sharing a phone*, which a
  unique index would reject forever. Duplicates are a search problem, not a
  constraint problem; they were all created weeks apart by staff who could
  not find the existing record.
- `producto.category_l1` is upper-cased on sync (`0011_fold_category_case`),
  so the ERP's `Accesorios` and `ACCESORIOS` collapse into one. The
  duplicates still exist upstream in Interfuerza.
- Nothing is deployed anywhere yet. Before a first deploy:
  - the PDF queue has to be drained with `scripts/macos/drain-pdf-queue.sh` — the
    job payload shape changed after those jobs were enqueued;
  - `cliente.phone` is `NOT NULL` since migration `0016`, and that migration
    is a bare `SET NOT NULL` that **hard-fails on the first null row rather
    than coercing one** — deliberately, because a customer's phone number is
    the owner's data and not something to invent. Run this against the target
    database before applying migrations to it, and resolve any rows it finds
    with the owner:

    ```sql
    select count(*) from cliente where phone is null or btrim(phone) = '';
    ```

    It has never had anything to find: every database this has run against
    holds dev rows only, and the real customer list lives in Interfuerza,
    which the import brings in already skipping the phone-less rows. The check
    lives here rather than in the change folder because that folder gets
    archived and this outlives it.
- Smaller deferrals from completed changes are registered in
  `openspec/changes/archive/README.md`, each labelled with the review round
  that raised it. They live outside the archived change folders on purpose:
  a follow-up buried in an archive nobody opens is the same loss as a
  deleted one.
