# Running standalone (no Docker)

The app can run with no Docker at all: a Homebrew Postgres whose data lives in
an ordinary folder on disk, plus the Next.js process. Nothing about the
application code changes — only where Postgres is.

The reason to bother: in the compose setup the database lives in the `db-data`
Docker volume, and `docker compose down -v` or `docker system prune` deletes it
with no confirmation and no way back. On a native Postgres the same data sits in
`/opt/homebrew/var/postgresql@17`, which survives uninstalling Docker entirely.

## Quick path

```bash
brew install postgresql@17     # once
./scripts/standalone.sh        # setup + build + start
```

That single command starts Postgres as a login-time service, creates the role
and database, brings over whatever is still inside the Docker container, patches
the one line of `.env` that has to change, runs migrations, seeds an
administrator if there are no users, builds, and starts the app on
`http://localhost:3000`.

Every step checks its own state first, so a run that fails halfway is resumed by
running the same command again. When something breaks it prints what is wrong
and the exact command that fixes it, then exits non-zero.

## What is actually stateful

| Thing | Where it lives | At risk in Docker? |
|-------|----------------|--------------------|
| App tables (`producto`, `cliente`, `orden_servicio`, …) | Postgres | Yes — the `db-data` volume |
| Job queue (pg-boss) | Postgres, `pgboss` schema, same database | Yes — same volume |
| Sessions, users | Postgres | Yes — same volume |
| Generated PDFs | Cloudflare R2 | No — never on local disk (NFR-6) |
| Secrets | `.env` | No — plain file in the checkout |

One database is the whole problem. That is why moving it is enough, and why no
code changes are needed.

## Commands

| Command | What it does |
|---------|--------------|
| `./scripts/standalone.sh` | Full setup, `next build`, then `next start` |
| `./scripts/standalone.sh --dev` | Same setup, but `next dev` (no build step) |
| `./scripts/standalone.sh --setup-only` | Database ready, app not started |
| `./scripts/standalone.sh backup` | `pg_dump -Fc` into `~/dforce-backups/` |
| `./scripts/standalone.sh restore FILE` | Restore a dump (asks first, backs up first) |
| `./scripts/standalone.sh status` | Where the data is, what is running, what `.env` points at |

Environment overrides: `APP_PORT` (default 3000), `PG_FORMULA` (default
`postgresql@17`), `DEV_USER` / `DEV_PASSWORD` for the seeded administrator,
`SKIP_IMPORT=1` to never read from the Docker container, `BACKUP_DIR`,
`FORCE=1` to skip the restore confirmation in a non-interactive shell.

## The one `.env` change

```diff
-DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_catalog
+DATABASE_URL=postgres://dforce:dforce@localhost:5432/dforce_catalog
```

5433 is the host port compose publishes; 5432 is where the native Postgres
answers. The script rewrites exactly this line and leaves a timestamped
`.env.bak-*` next to it — every other line, tokens included, is untouched.

This is the failure worth understanding, because it does not look like a
failure: with a native Postgres running on 5432 and `.env` still pointing at
5433 (or the reverse), the app connects successfully to the *wrong* database and
simply renders as empty. Nothing logs an error. `./scripts/standalone.sh status`
prints which one `.env` currently points at.

## Two databases named `dforce_catalog`

If a native `dforce_catalog` already exists **and** the compose container is
running, the script refuses to guess and stops, printing the table count on both
sides. It will not overwrite a database you did not ask it to overwrite.

Bring the container's data over (a backup is taken before anything is replaced):

```bash
docker compose exec -T db pg_dump -U dforce -Fc dforce_catalog > /tmp/docker.dump
./scripts/standalone.sh restore /tmp/docker.dump
```

Or keep the native one as-is:

```bash
SKIP_IMPORT=1 ./scripts/standalone.sh
```

Compare them first if you are unsure:

```bash
psql -h localhost -p 5432 -U dforce -d dforce_catalog -c '\dt'
docker compose exec -T db psql -U dforce -d dforce_catalog -c '\dt'
```

## Not losing data

A data directory is not a backup. It does not survive a disk failure, a bad
migration, or a `DELETE` without a `WHERE`. The backup is a dump file.

```bash
./scripts/standalone.sh backup
# → ~/dforce-backups/dforce_catalog-20260830-032350.dump
```

Custom format (`-Fc`), so `pg_restore` can restore it selectively and the file is
compressed. Restore any of them with `./scripts/standalone.sh restore <file>` —
it takes a fresh backup of the current state before replacing it.

For a nightly one, `cron` is enough:

```bash
crontab -e
# 0 2 * * * cd "$HOME/Desktop/Works/Dforce Car/Proyecto Catalogo" && ./scripts/standalone.sh backup >> /tmp/dforce-backup.log 2>&1
```

Backups live in `$HOME`, outside the repo — they contain real customer data and
must never be committed. Copy them off the machine periodically; a backup on the
same disk as the database only protects against mistakes, not against the disk.

## When something fails

The script explains itself, but the underlying causes are these:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `initdb` needed / no cluster | Data directory deleted by hand | The script recreates it; the old data is gone unless you have a dump |
| Postgres starts but never accepts connections | Cluster made by a different major version, or full disk | `tail -50 $(brew --prefix)/var/log/postgresql@17.log` — the real reason is always there |
| `address already in use` on 5432 | Another Postgres (or an old `brew services` entry) | `lsof -nP -iTCP:5432 -sTCP:LISTEN` |
| Cannot connect as your macOS user | Cluster not created by this Homebrew install | Create the superuser role by hand — the script prints the exact `psql` line |
| Migrations fail with `relation already exists` | Schema applied but not recorded | Compare `drizzle.__drizzle_migrations` against `src/shared/db/migrations/meta/_journal.json`. That table is authoritative — `public.__drizzle_migrations` is a leftover nobody reads |
| App starts, everything is empty | `.env` points at the other Postgres | `./scripts/standalone.sh status` |

## Going back to Docker

Nothing is burned. The compose volume is never deleted by this script.

```bash
# .env → back to :5433
docker compose up -d db
./scripts/dev.sh
```

To move current native data back into the container, dump it and restore it
inside — the same `pg_dump -Fc` / `pg_restore` pair, in the other direction.

## Why not SQLite or PGlite

It would be a rewrite for nothing. pg-boss — the queue behind reminders and PDF
generation — requires a real Postgres, and the Drizzle schema is written in the
`pg` dialect. Native Postgres already gives standalone operation and a data
directory you control; swapping the engine buys no additional persistence.
