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
| `./scripts/standalone.sh install-service` | Start the app at login and keep it up (launchd) |
| `./scripts/standalone.sh uninstall-service` | Remove that LaunchAgent; Postgres is untouched |

Environment overrides: `APP_PORT` (default 3000), `PG_FORMULA` (default
`postgresql@17`), `DEV_USER` / `DEV_PASSWORD` for the seeded administrator,
`SKIP_IMPORT=1` to never read from the Docker container, `BACKUP_DIR`,
`FORCE=1` to skip the restore confirmation in a non-interactive shell.

## The workshop Mac: coming back after a power cut

On the workshop Mac nobody watches a terminal, and the machine gets switched
off. `./scripts/standalone.sh` on its own is the wrong shape for that: it runs
the app in the foreground under `trap cleanup EXIT`, so closing the terminal
window — or logging out, or a power cut — takes the app with it, and nothing
brings it back.

`install-service` writes a launchd **user LaunchAgent**
(`~/Library/LaunchAgents/com.dforce.catalog.plist`) with `RunAtLoad` and
`KeepAlive`, so the app starts at login and launchd restarts it if it dies.
launchd is macOS's own supervisor; there is no pm2 or equivalent here on
purpose.

```bash
cd ~/dforce-catalog              # NOT ~/Desktop — see below
./scripts/standalone.sh          # setup, migrations, build — once, interactively
# Ctrl-C once you have seen it work, then:
./scripts/standalone.sh install-service
```

`install-service` refuses rather than guesses, and it tells you the exact fix
each time: no `.next`, no `DATABASE_URL`, the port already taken, no `node` to
resolve a PATH from. It is re-runnable — run it again after a Node upgrade or a
moved checkout and it rewrites the plist and reloads the service. It then polls
the port and reports whether the app *actually answered*, which is a different
question from whether launchd accepted the job.

### Three things that decide whether this works at all

| Requirement | Why it is load-bearing |
|-------------|------------------------|
| The repo must **not** live in `~/Desktop`, `~/Documents` or `~/Downloads` | macOS protects those three folders (TCC). A GUI app gets an "allow access" prompt; a launchd job never does — it just fails with `Operation not permitted` and the app never starts. Verified: the identical plist runs the app from `~/` and fails from `~/Desktop`. `install-service` refuses up front rather than installing a service that cannot work. `~/dforce-catalog` is a fine home |
| **Somebody must log in after a boot** — either a person, or automatically (System Settings → Users & Groups → Automatic login) | Both this service and Homebrew's Postgres are *user* LaunchAgents, and a user LaunchAgent does not load until somebody logs in. Until then the Mac sits at the login window with the app down. See the FileVault note below before planning around automatic login: with FileVault on it is not offered at all |
| `node` comes from nvm | nvm lives in the shell profile, so it is nowhere near launchd's PATH, and a service that inherits the default PATH dies at boot with `npm: command not found`. `install-service` resolves `command -v node` at install time and bakes that absolute directory into the plist's `EnvironmentVariables`. A Node version bump therefore means re-running `install-service` |

### FileVault and automatic login are mutually exclusive

macOS does not offer automatic login while FileVault is on — the option is
greyed out, because the volume is encrypted and the account password is what
unlocks it at boot. So "turn on automatic login" is unfollowable advice on a
FileVault machine, and the dev Mac this was built on is one (`fdesetup status`
→ `FileVault is On`).

That is not a problem to engineer around, and a LaunchDaemon does not solve it
either: with FileVault, **nothing** on the disk runs until a human unlocks the
volume at the pre-boot screen. Check which situation a machine is in with
`fdesetup status`, then pick:

| FileVault | What a power cut costs |
|-----------|------------------------|
| On (recommended) | One password at the pre-boot screen. That unlock *is* the login, so every LaunchAgent — Postgres and this service — comes up right after it. One human action, then unattended |
| Off + automatic login | Zero human actions, fully unattended. The disk is unencrypted, so a stolen machine hands over the customer database and `.env` |

Encryption is worth more here than skipping one password: the data is real
customer records, and the machine sits in a workshop.

**On a laptop that table is better than it looks.** A MacBook's battery is a
UPS: a power cut does not shut it down, so there is no reboot, no pre-boot
screen and no password to type — the app never goes down in the first place.
The password in the top row is only ever paid on a real shutdown. So on a
laptop FileVault costs nothing operationally, and this stops being a trade at
all: leave it on.

### Postgres is not ours to supervise

`brew services start postgresql@17` already wrote its own user LaunchAgent
(today `~/Library/LaunchAgents/sh.brew.postgresql@17.plist`) with `RunAtLoad`
and `KeepAlive`, so Postgres comes back at login on its own. Nothing here
duplicates or rewrites it, and `uninstall-service` deliberately leaves it
running.

What that does create is a race: at login launchd starts both jobs at once, and
`next start` can reach a Postgres that is not accepting connections yet. That
failure does **not** look like a crash — measured on this machine, the app keeps
listening and answers every request with a **500**, logging only
`An error occurred while loading instrumentation hook`. launchd sees a healthy
process and leaves it there serving 500s forever, because the half that needed
the database is `src/instrumentation.ts`, which registers the pg-boss workers at
boot.

So the plist does not exec `standalone.sh` (its `EXIT` trap would kill the very
app it started). It execs `scripts/service-start.sh`, whose only job is to wait
on `pg_isready` before handing off with `exec npm run start`. It reads the host
and port out of `.env`'s `DATABASE_URL` rather than assuming 5432 — on a machine
that still has Docker, `.env` legitimately points at 5433, and waiting on the
native server there would be waiting on the wrong one. If Postgres never
answers it exits non-zero with the reason and the fixing command in the log,
instead of starting an app that would lie about being up.

### The LAN URL, and the firewall prompt

`next start` binds `0.0.0.0` (Next 16's default hostname), so the other machines
in the workshop can reach it with no extra flag — they were just never told the
address. `install-service`, a normal run, and `status` all print it now:

```
✓ La app contesta en http://localhost:3000
✓ Desde las otras máquinas: http://192.168.0.7:3000
```

The address comes from `ipconfig getifaddr en0`, falling back to `en1`. With
neither answering it says so rather than printing a blank or guessed URL.

Two things to expect:

- **macOS may ask to allow incoming connections** the first time, and until
  somebody clicks Allow the other machines get nothing. It is a dialog on the
  workshop Mac's own screen, so it has to be answered there.
- **The IP is from DHCP and can move.** A reserved address on the router, or a
  static one on the Mac, is what stops the staff's bookmarks from rotting.

### Never sleeping

A sleeping Mac answers nothing on the LAN.

```bash
sudo pmset -a sleep 0 disksleep 0     # never sleep, never spin the disk down
sudo pmset -a autorestart 1           # desktop Macs ONLY — see below
```

`autorestart` (come back after a power failure) is not a capability every Mac
has: `pmset -g cap` does not list it on a laptop, where the battery makes it
meaningless. Run `pmset -g cap | grep autorestart` first and skip the line if it
prints nothing — setting it on a MacBook is a no-op, not a fix.

Display sleep is fine to leave on; it is not sleep.

#### Closing the lid is the one that will actually bite you

`sleep 0` covers the idle timer. It does not cover the lid: closing a MacBook
suspends it anyway, and the whole workshop loses the app until somebody opens
it again. Clamshell mode — lid shut and still awake — needs mains power *and*
an external display *and* an external keyboard or mouse. Take the display away
and macOS sleeps.

So either leave the lid open, or:

```bash
sudo pmset -a disablesleep 1
```

Read that one with your eyes open: `disablesleep` is **not in `man pmset`**. It
is real — `pmset -g` reports it back as `SleepDisabled` — but an undocumented
flag is one Apple never promised to keep. Leaving the lid open is the boring
option, and it cannot be removed in an update.

### Reading the log

Everything the service prints — `service-start.sh`'s own lines plus all of
Next's stdout and stderr — goes to one file:

```bash
tail -f ~/Library/Logs/dforce-catalog.log
```

That is the first place to look for every failure in this section, and the path
`install-service` points at when the app does not come up. `launchctl print
gui/$(id -u)/com.dforce.catalog` is the other half of the picture: whether
launchd has the job, its PID, and how many times it has restarted.

`./scripts/standalone.sh status` now answers "is the service installed and
loaded, and what is the LAN URL" alongside the database questions it already
answered.

### Updating the code is still a manual step

The service runs `next start`, which serves the **already-built** `.next`. It
does not pull, install, migrate or build. A new version is deployed by doing
that yourself and restarting the service:

```bash
cd ~/dforce-catalog
git pull
npm ci
./scripts/standalone.sh --setup-only     # migrations, and the Chromium check
npm run build
./scripts/standalone.sh install-service  # re-runnable: reloads the service
```

Deliberately not automated. An unattended `git pull && build` on the machine the
workshop depends on turns a bad commit into an outage nobody is watching.

## Chromium, and the catalog PDFs

Catalog PDFs are rendered by Playwright's Chromium, and
`src/modules/pdf-generation/worker.ts` calls `chromium.launch()` with no
`executablePath` — so the binary is resolved from a per-user cache at
`~/Library/Caches/ms-playwright`. Under Docker it came from the base image,
which is why this never needed mentioning before, and why it is the one gap that
breaks *silently* on a fresh Mac: everything else works, and only the catalog
job fails.

`./scripts/standalone.sh` now checks for it and downloads it once (~150 MB) if
it is missing, as part of the normal setup. Nothing is downloaded when it is
already there. By hand it is:

```bash
npx playwright install chromium
```

The rest of the app is unaffected if this fails — only generating catalogs is.

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
| Service log says `Operation not permitted` | The checkout is in `~/Desktop`, `~/Documents` or `~/Downloads`, which launchd cannot read | Move it: `mv <repo> ~/dforce-catalog`, then `install-service` again |
| App did not come back after a reboot | Auto-login is off, so no user LaunchAgent loaded — Postgres is down too | System Settings → Users & Groups → Automatic login |
| Worked all day, then stopped answering on the LAN | Somebody closed the lid. `sleep 0` does not cover it | Open it. To stop it recurring, see "Closing the lid" above |
| Service log says `npm: command not found` | The plist's baked PATH points at a Node that is gone (nvm upgrade) | `./scripts/standalone.sh install-service` — it re-resolves `node` |
| Every page returns 500 after a reboot | The app won the race against Postgres. Should not happen now (`service-start.sh` waits), but this is the symptom | `tail ~/Library/Logs/dforce-catalog.log`, then `./scripts/standalone.sh install-service` to reload the service |
| Catalog PDFs fail, everything else works | Playwright's Chromium was never downloaded on this Mac | `npx playwright install chromium` |

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
