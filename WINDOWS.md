# Running on Windows (no Docker)

The Windows counterpart of `STANDALONE.md`: the app, a PostgreSQL installed as
a real Windows service, and a Task Scheduler task that brings both back after a
power cut with nobody logged in. No Docker, no NSSM, nothing downloaded from
outside the official installers.

Everything lives in two scripts:

| File | What it is |
|------|------------|
| `scripts\windows\standalone.ps1` | Setup, build, start, backup/restore, and the boot task. The port of `scripts/standalone.sh` |
| `scripts\windows\service-start.ps1` | What the boot task actually runs. Waits for Postgres, then starts the app, and logs both |

`scripts\migrate.mjs` and `scripts\seed-user.mjs` are cross-platform Node and
stay where they are — these scripts call them there.

## Requirements

| Requirement | Why it decides whether this works at all |
|-------------|------------------------------------------|
| **Windows 10 Pro** with the built-in PowerShell 5.1 | Both scripts target 5.1 on purpose. PowerShell 7 is not needed and not assumed |
| **PostgreSQL 17**, installed with the official EDB installer | It registers a real Windows service (`postgresql-x64-17`) that starts at boot on its own. Write down the `postgres` superuser password it asks for — the setup script needs it once, to create the role and the database |
| **Node 20+ installed machine-wide** | The boot task runs as `SYSTEM`, whose `PATH` is not yours. `install-service` resolves `node` at install time and bakes the absolute directory into the task, exactly like the macOS version bakes it into the plist. A per-user Node (nvm-windows, a portable unzip inside your profile) may be unreadable to `SYSTEM`; the script warns about it |
| The checkout **not** inside OneDrive | OneDrive's "files on demand" are paged in by the signed-in user's session, not by `SYSTEM`. `C:\dforce-catalog` is a fine home. The script warns rather than refuses here, because this one is not verified |

## Install sequence

PowerShell 5.1 does not run unsigned scripts by default, so every command below
goes through `-ExecutionPolicy Bypass`.

```powershell
winget install PostgreSQL.PostgreSQL.17
winget install OpenJS.NodeJS.LTS
# close and reopen PowerShell: PATH only refreshes in a new console

cd C:\dforce-catalog
npm ci
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1
```

That last command does the whole setup and then builds and starts the app in
the foreground: it checks the PostgreSQL service is installed and answering,
creates the `dforce` role and the `dforce_catalog` database if they are absent,
copies `env.example` to `.env` if there is none, points `DATABASE_URL` at the
local Postgres port, runs the migrations, seeds an `admin` administrator when
the `users` table is empty, downloads Playwright's Chromium if it is missing,
and builds.

Every step checks its own state first, so a run that fails halfway is resumed
by running the same command again. When something breaks it prints what is
wrong and the exact command that fixes it, then exits non-zero.

Once you have seen it work, `Ctrl-C` it and install the boot task from an
**administrator** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
```

## Commands

| Command | What it does |
|---------|--------------|
| `standalone.ps1` | Full setup, `next build`, then `next start` in the foreground |
| `standalone.ps1 -SetupOnly` | Database ready, app not started |
| `standalone.ps1 install-service` | Register the boot task and the firewall rule (needs admin) |
| `standalone.ps1 uninstall-service` | Remove both; PostgreSQL is untouched (needs admin) |
| `standalone.ps1 status` | What is running, what `.env` points at, whether the task is there and whether the app answers |
| `standalone.ps1 backup` | `pg_dump -Fc` into `%USERPROFILE%\dforce-backups` |
| `standalone.ps1 restore <file>` | Restore a dump — asks first, and backs up the current state before replacing it |

Parameters: `-Port` (3000), `-PgHost` (localhost), `-PgPort` (5432),
`-SuperPassword`, `-SeedUser` / `-SeedPassword`, `-BackupDir`, `-Yes` (skip the
restore confirmation in a non-interactive shell).

## The boot task, and what it costs

`install-service` registers a Task Scheduler task named `DforceCatalogo`:

- **Triggered at system startup**, not at logon. A power cut has to bring the
  app back with nobody logged in, which is the whole reason this exists.
- **Runs whether a user is logged on or not**, because it runs as a service
  account.
- **Restarts automatically** if the process dies: every minute, up to 999
  times.

### It runs as SYSTEM, and that is a real trade

Task Scheduler gives exactly two ways to get "at startup, logged on or not":

| Account | What it costs |
|---------|---------------|
| A normal user account | Task Scheduler **stores that account's password** at registration. It has to be typed in, and the next time the password changes — an IT policy, an expiry — the task fails at boot with a credentials error and nobody finds out until the workshop calls |
| `SYSTEM` (chosen) | No password is stored or typed, ever. Nothing to expire. But the app runs with **full privileges over the machine**: a remote-code-execution bug in the app is a machine compromise, not a user-account one |

`SYSTEM` is what this repo picks. The reasoning is the same one `STANDALONE.md`
applies to FileVault: the failure that matters on an unattended workshop machine
is the silent one, and a stored password that goes stale months later is exactly
that. A privilege boundary you can see beats a boot path that breaks quietly.

State the consequence plainly: **this app runs as the most privileged account on
that Windows machine.** If that is not acceptable, the alternative is a
dedicated low-privilege local account with "log on as a batch job" and a stored
password — more moving parts than this deployment has, and not implemented here.

Two consequences of `SYSTEM` that are already handled, and are worth knowing
about because they are the kind that fail silently:

- **`SYSTEM` has its own profile**, so a per-user cache is not yours. Playwright
  resolves Chromium out of a cache directory, so both the install step and the
  service pin `PLAYWRIGHT_BROWSERS_PATH` to `C:\ProgramData\ms-playwright`.
  Without that, everything would work except generating catalog PDFs, and
  nothing would say why.
- **`SYSTEM` has no mapped network drives.** The repo and the database have to
  be on local disks.

### Re-runnable

`install-service` rewrites the task every time (`Register-ScheduledTask -Force`).
Run it again after a Node upgrade, a moved checkout, or a port change. It
refuses rather than guesses: no `.next` build, no `.env`, no `DATABASE_URL`, no
`node`, port already taken, not running as administrator.

After registering it **starts the task and polls the port**, then reports
whether the app actually answered — a different question from whether Windows
accepted the task.

## What to expect

### The firewall

`install-service` creates an inbound TCP rule for the app's port on the
**Private and Domain** profiles. It does not open the Public profile: on a
network Windows classifies as public, the catalog should not answer.

This rule is not a convenience. A process running as `SYSTEM` at boot never
gets the "allow this app to communicate" dialog — that dialog only appears for
a process in an interactive desktop session. Without an explicit rule the LAN
URL would simply not answer, with no prompt and no error.

Running `standalone.ps1` by hand in the foreground **does** run in your session,
so that first run is where you may see the dialog. Click Allow.

### The LAN URL moves

`next start` binds `0.0.0.0` (Next 16's default hostname), so the other
machines in the workshop reach it with no extra flag — they were just never
told the address. `install-service`, a normal run, and `status` all print it,
taken from the first active adapter that has an IPv4 default gateway. When
nothing resolves it says so rather than printing a blank or guessed URL.

That address comes from DHCP and can move. A reserved address on the router is
what stops the staff's bookmarks from rotting.

### Never sleeping

A sleeping PC answers nothing on the LAN. From an administrator PowerShell:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
```

Monitor sleep is fine to leave on; it is not sleep.

Two more, outside Windows:

- **"Restore on AC power loss" in the BIOS/UEFI.** Without it the machine stays
  off after a power cut and none of this runs. The setting is usually under
  Power Management and is named something like *Restore on AC Power Loss*,
  *AC Back Function*, or *After Power Failure* — set it to *Power On* / *Last
  State*. There is no way to set this from Windows.
- **On a laptop, closing the lid** suspends it regardless of the timeouts above.
  Set *Choose what closing the lid does* to *Do nothing* while plugged in, or
  leave the lid open.

### Reading the log

Everything the service prints — `service-start.ps1`'s own timestamped lines plus
all of Next's stdout and stderr — goes to one file, under the task account's
`%LOCALAPPDATA%`. As `SYSTEM` that resolves to:

```
C:\Windows\System32\config\systemprofile\AppData\Local\dforce-catalog\service.log
```

`install-service` and `status` both print that exact path. Reading it needs an
administrator console:

```powershell
Get-Content "$env:SystemRoot\System32\config\systemprofile\AppData\Local\dforce-catalog\service.log" -Tail 50
```

It rolls once at 10 MB (`service.log.1`). The other half of the picture is the
task itself:

```powershell
Get-ScheduledTask -TaskName DforceCatalogo
Get-ScheduledTaskInfo -TaskName DforceCatalogo   # LastRunTime, LastTaskResult
```

### Postgres is not ours to supervise

The EDB installer already registered `postgresql-x64-17` with Windows' own
service manager, set to start automatically. Nothing here duplicates it, and
`uninstall-service` deliberately leaves it running.

What that creates is a race: at boot both start at once, and `next start` can
reach a Postgres that is not accepting connections yet. That failure does **not**
look like a crash — the app keeps listening and answers every request with a
**500**, logging only `An error occurred while loading instrumentation hook`,
because the half that needed the database is `src/instrumentation.ts`, which
registers the pg-boss workers at boot. A supervisor sees a healthy process and
leaves it there serving 500s forever.

So the task does not run `standalone.ps1`. It runs `service-start.ps1`, whose
only job is to poll `pg_isready.exe` before handing off to `npm run start`. It
reads the host and port out of `.env`'s `DATABASE_URL` rather than assuming
5432 — on a machine that still has Docker, `.env` legitimately points at 5433.
If Postgres never answers in 60 seconds it exits non-zero with the reason and
the fixing command in the log, instead of starting an app that would lie about
being up.

One Windows-specific wrinkle: Task Scheduler only restarts a task that **ends in
failure**, so a clean `exit 0` from the app would leave the workshop with no app
and a task the console happily reports as "completed successfully".
`service-start.ps1` therefore reports a zero exit as a failure — the app is
never supposed to exit at all.

### Updating the code is still a manual step

The task runs `next start`, which serves the already-built `.next`. It does not
pull, install, migrate or build.

```powershell
cd C:\dforce-catalog
git pull
npm ci
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 -SetupOnly
npm run build
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 install-service
```

Deliberately not automated. An unattended `git pull && build` on the machine the
workshop depends on turns a bad commit into an outage nobody is watching.

## The one `.env` change

```diff
-DATABASE_URL=postgres://dforce:dforce@localhost:5433/dforce_catalog
+DATABASE_URL=postgres://dforce:dforce@localhost:5432/dforce_catalog
```

5433 is the host port compose publishes; 5432 is where a locally installed
Postgres answers. `standalone.ps1` rewrites exactly that line, leaves a
timestamped `.env.bak-*` next to it, and writes the file back as **UTF-8 with no
BOM** — `Out-File` in PowerShell 5.1 would write UTF-16, and its `-Encoding
utf8` would prepend a BOM that arrives glued to the first key name and breaks
`.env` for Node.

This is the failure worth understanding because it does not look like one: with
Postgres on 5432 and `.env` still pointing at 5433 (or the reverse), the app
connects successfully to the *wrong* database and simply renders as empty.
Nothing logs an error. `standalone.ps1 status` prints which one `.env` points at.

## Backups

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\standalone.ps1 backup
# -> C:\Users\<you>\dforce-backups\dforce_catalog-20260911-143012.dump
```

Custom format (`-Fc`), same as the macOS path, so the two are interchangeable.
`restore <file>` takes a fresh backup of the current state before replacing
anything.

A nightly one is another scheduled task:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-ExecutionPolicy Bypass -File C:\dforce-catalog\scripts\windows\standalone.ps1 backup' `
  -WorkingDirectory C:\dforce-catalog
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName DforceCatalogoBackup -Action $action -Trigger $trigger
```

Backups live outside the repo — they contain real customer data and must never
be committed. Copy them off the machine periodically; a backup on the same disk
as the database only protects against mistakes, not against the disk.

## When something fails

| Symptom | Cause | Fix |
|---------|-------|-----|
| `...standalone.ps1 cannot be loaded because running scripts is disabled` | Default PowerShell 5.1 execution policy | Run it as `powershell -ExecutionPolicy Bypass -File ...`, as every command here does |
| Accented text prints as `Ã¡`, `Ã³` | The `.ps1` lost its UTF-8 BOM, so 5.1 read it as the ANSI codepage | Restore it from git; do not re-save either script without the BOM |
| `No encontré ningún servicio de PostgreSQL` | PostgreSQL was never installed, or installed as a portable zip with no service | `winget install PostgreSQL.PostgreSQL.17` |
| `no me deja conectar como 'postgres'` | Wrong superuser password | Pass it: `standalone.ps1 -SuperPassword <clave>`. If it is lost, reset it by setting `trust` in `pg_hba.conf`, restarting the service, and running `ALTER USER` |
| Postgres answers on a port that is not 5432 | Another instance already had 5432 when the installer ran | Check `postgresql.conf` for `port`, then pass `-PgPort <n>` |
| Migrations fail with `relation already exists` | Schema applied but not recorded | Compare `drizzle.__drizzle_migrations` against `src\shared\db\migrations\meta\_journal.json`. That table is authoritative — `public.__drizzle_migrations` is a leftover nobody reads |
| App starts, everything is empty | `.env` points at the other Postgres | `standalone.ps1 status` |
| `install-service` says it needs administrator | Registering a SYSTEM task and a firewall rule both require elevation | Right-click PowerShell → Run as administrator |
| Task registered, app never answers | Read the log first — it says which of these it was | `Get-Content <the systemprofile path above> -Tail 50` |
| Log says Postgres never accepted connections | The PostgreSQL service did not start, or `DATABASE_URL` points at a port nothing listens on | `Start-Service postgresql-x64-17`, then `Start-ScheduledTask -TaskName DforceCatalogo` |
| Log says `npm` is not recognized | The baked Node directory is gone (an upgrade moved it) | Re-run `install-service`; it re-resolves `node` |
| Task shows "completed successfully" but nothing is running | The app exited cleanly and Task Scheduler did not treat that as a failure | Should not happen now — `service-start.ps1` reports a zero exit as a failure. If it does, read the log for why the app exited |
| App answers on `localhost` but not from other machines | No firewall rule, or Windows classified the network as Public | `standalone.ps1 status` shows whether the rule exists. Set the network to Private in Settings → Network |
| Worked yesterday, other machines get nothing today | The DHCP lease moved the IP | `standalone.ps1 status` prints the current one. Reserve it on the router |
| Machine stayed off after a power cut | BIOS "restore on AC power loss" is not set | Set it in the BIOS; Windows cannot |
| Catalog PDFs fail, everything else works | Chromium is missing from `C:\ProgramData\ms-playwright` | `$env:PLAYWRIGHT_BROWSERS_PATH = "C:\ProgramData\ms-playwright"; npx playwright install chromium` |

## What is not covered here

- No import from a Docker container. The macOS script has one because that Mac
  was migrating off compose; a fresh Windows machine has nothing to import.
  Move data with `backup` on one side and `restore` on the other — both use the
  same `pg_dump -Fc` format.
- No `--dev` mode. The workshop machine runs the production build; develop on
  the machine you develop on.
