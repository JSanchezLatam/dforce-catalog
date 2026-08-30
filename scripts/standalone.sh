#!/usr/bin/env bash
#
# Run the whole app WITHOUT Docker, against a Homebrew Postgres whose data
# lives in a plain directory on disk instead of a Docker volume.
#
# Why this exists: the only stateful dependency is Postgres (pg-boss's queue
# schema lives in the same database, PDFs live in R2). In the compose setup
# that database sits inside the `db-data` volume, which `docker system prune`
# and `docker compose down -v` delete without warning. Moving it to
# $(brew --prefix)/var/postgresql@17 makes it an ordinary folder that survives
# uninstalling Docker entirely.
#
# Every step is idempotent: a failed run is resumed by running the script
# again, and each already-satisfied step is detected and skipped. When
# something fails it prints what is wrong and the exact command that fixes it.
#
# Usage:
#   ./scripts/standalone.sh              setup + build + start (production)
#   ./scripts/standalone.sh --dev        same, but `next dev` instead
#   ./scripts/standalone.sh --setup-only stop before building/starting the app
#   ./scripts/standalone.sh backup       dump the database to ~/dforce-backups
#   ./scripts/standalone.sh restore FILE restore a dump (destructive, asks first)
#   ./scripts/standalone.sh status       where the data lives and what is running
#
# Env: APP_PORT (default 3000), PG_FORMULA (default postgresql@17),
#      DEV_USER / DEV_PASSWORD (default admin / admin123) for the
#      administrator seeded when the users table is empty,
#      SKIP_IMPORT=1 to never copy data out of the Docker container,
#      FORCE=1 to answer "yes" to the restore confirmation (non-interactive)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
PG_FORMULA="${PG_FORMULA:-postgresql@17}"

# The standalone Postgres answers on the default port. docker-compose publishes
# 5433 precisely to stay out of its way, which is why moving over means
# rewriting exactly one line of .env.
PG_PORT=5432
DOCKER_PG_PORT=5433

DB_NAME=dforce_catalog
DB_USER=dforce
DB_PASSWORD=dforce

BACKUP_DIR="${BACKUP_DIR:-$HOME/dforce-backups}"

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; BLUE=''; DIM=''; OFF=''
fi

step() { printf '\n%s▸ %s%s\n' "$BLUE" "$1" "$OFF"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$RED" "$OFF" "$1"; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$OFF"; }

# fail <what is wrong> <how to fix it>
fail() {
  printf '\n%s✗ %s%s\n\n' "$RED" "$1" "$OFF" >&2
  printf '  Cómo arreglarlo:\n\n' >&2
  printf '%s\n' "$2" | sed 's/^/    /' >&2
  printf '\n' >&2
  exit 1
}

# Reads only the KEY=value shape out of an env file, never echoes a value.
env_value() {
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" \
    | tail -1 \
    | tr -d '"'\''' \
    | tr -d '\r' \
    | sed 's/[[:space:]]*$//'
}

# --------------------------------------------------------------------------
# Postgres binaries
# --------------------------------------------------------------------------
# Homebrew keeps versioned formulae out of the PATH on purpose (they are
# keg-only), so `psql` on a bare shell is either missing or some other
# version. Resolving the prefix and prepending it is what makes every pg_*
# call below hit the same server this script starts.
resolve_pg() {
  command -v brew >/dev/null 2>&1 || fail \
    "No encontré Homebrew, que es de dónde sale el Postgres nativo." \
    "Instalalo desde https://brew.sh y después:

  brew install $PG_FORMULA
  ./scripts/standalone.sh"

  PG_PREFIX="$(brew --prefix "$PG_FORMULA" 2>/dev/null)"
  if [ -z "$PG_PREFIX" ] || [ ! -x "$PG_PREFIX/bin/psql" ]; then
    fail \
      "$PG_FORMULA no está instalado (o quedó a medias): no existe su psql." \
      "brew install $PG_FORMULA

Si querés otra versión mayor, pasala por variable — pero tiene que ser
>= la del contenedor (postgres:17-alpine), o pg_restore rechaza el dump:

  PG_FORMULA=postgresql@18 ./scripts/standalone.sh"
  fi

  export PATH="$PG_PREFIX/bin:$PATH"
  # Where the data actually lives. This is the whole point of the script, so
  # it gets printed on every run.
  PG_DATA_DIR="$(brew --prefix)/var/$PG_FORMULA"
  PG_LOG="$(brew --prefix)/var/log/$PG_FORMULA.log"
}

pg_up() { pg_isready -h localhost -p "$PG_PORT" -q >/dev/null 2>&1; }

start_postgres() {
  step "Postgres nativo"

  if pg_up; then
    ok "Ya está aceptando conexiones en localhost:$PG_PORT"
  else
    # initdb is normally run by the formula's post-install. It is missing when
    # the data directory was deleted by hand, and the failure that follows
    # ("could not open directory") reads like a permissions problem instead.
    if [ ! -f "$PG_DATA_DIR/PG_VERSION" ]; then
      warn "No hay cluster inicializado en $PG_DATA_DIR — creándolo."
      INITDB_OUT="$(initdb --locale=C -E UTF-8 "$PG_DATA_DIR" 2>&1)" || fail \
        "initdb falló y sin cluster no hay base de datos. Salida completa:

$INITDB_OUT" \
        "Si el directorio existe pero está a medias, movelo y reintentá:

  mv '$PG_DATA_DIR' '$PG_DATA_DIR.roto'
  ./scripts/standalone.sh"
      ok "Cluster creado"
    fi

    BREW_OUT="$(brew services start "$PG_FORMULA" 2>&1)" || fail \
      "No pude arrancar $PG_FORMULA como servicio. Salida completa:

$BREW_OUT" \
      "Mirá el log del servidor:

  tail -50 '$PG_LOG'

Si dice 'address already in use', algo más tiene el puerto $PG_PORT:

  lsof -nP -iTCP:$PG_PORT -sTCP:LISTEN"

    printf '  esperando a que Postgres acepte conexiones'
    WAITED=0
    until pg_up; do
      WAITED=$((WAITED + 1))
      if [ "$WAITED" -ge 30 ]; then
        printf '\n'
        fail \
          "Postgres arrancó como servicio pero no aceptó conexiones en 30s." \
          "El motivo real siempre está en el log del servidor:

  tail -50 '$PG_LOG'

Causas típicas: el cluster fue creado por una versión mayor distinta
('database files are incompatible'), o el disco está lleno."
      fi
      printf '.'
      sleep 1
    done
    printf '\n'
    ok "Arrancado y escuchando en localhost:$PG_PORT"
  fi

  note "datos en $PG_DATA_DIR (carpeta común, no un volumen de Docker)"
}

# --------------------------------------------------------------------------
# Role and database
# --------------------------------------------------------------------------
# Everything here runs as the current macOS user, who is the superuser a
# Homebrew install creates. `psql -d postgres` is the connection that proves
# it before anything else is attempted.
ensure_role_and_db() {
  step "Rol y base de datos"

  PSQL_CHECK="$(psql -h localhost -p "$PG_PORT" -d postgres -tAc 'select 1' 2>&1)"
  if [ "$PSQL_CHECK" != "1" ]; then
    fail \
      "Postgres está arriba pero no me deja conectar como '$(whoami)'. Dijo:

$PSQL_CHECK" \
      "Un cluster de Homebrew crea un superusuario con tu nombre de usuario.
Si este cluster vino de otro lado, conectá con el superusuario que sí
exista y creá el tuyo:

  psql -h localhost -p $PG_PORT -U postgres -d postgres \\
    -c 'create role \"$(whoami)\" login superuser;'"
  fi

  if [ "$(psql -h localhost -p "$PG_PORT" -d postgres -tAc "select 1 from pg_roles where rolname='$DB_USER'" 2>/dev/null)" = "1" ]; then
    ok "Rol '$DB_USER' ya existe"
  else
    psql -h localhost -p "$PG_PORT" -d postgres -q \
      -c "create role \"$DB_USER\" login password '$DB_PASSWORD';" >/dev/null 2>&1 || fail \
      "No pude crear el rol '$DB_USER'." \
      "Crealo a mano y volvé a correr el script:

  psql -h localhost -p $PG_PORT -d postgres \\
    -c \"create role $DB_USER login password '$DB_PASSWORD';\""
    ok "Rol '$DB_USER' creado"
  fi

  if [ "$(psql -h localhost -p "$PG_PORT" -d postgres -tAc "select 1 from pg_database where datname='$DB_NAME'" 2>/dev/null)" = "1" ]; then
    ok "Base '$DB_NAME' ya existe"
  else
    CREATE_OUT="$(createdb -h localhost -p "$PG_PORT" -O "$DB_USER" "$DB_NAME" 2>&1)" || fail \
      "No pude crear la base '$DB_NAME'. Salida completa:

$CREATE_OUT" \
      "createdb -h localhost -p $PG_PORT -O $DB_USER $DB_NAME"
    ok "Base '$DB_NAME' creada"
  fi
}

# Number of user tables already in the target database. 0 means "virgin",
# which is the only state where importing from Docker is safe.
table_count() {
  psql -h localhost -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null \
    | tr -d '[:space:]'
}

# Same count inside the compose container, used only to show both sides when
# the two databases disagree.
docker_table_count() {
  (cd "$ROOT" && docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null) \
    | tr -d '[:space:]'
}

# --------------------------------------------------------------------------
# One-time import out of the Docker volume
# --------------------------------------------------------------------------
# Runs only when the native database is empty AND the compose container is up.
# Both conditions matter: skipping on a non-empty target is what makes the
# whole script safe to re-run, and the container is the only place the old
# data exists.
import_from_docker() {
  step "Datos previos del contenedor de Docker"

  if [ -n "${SKIP_IMPORT:-}" ]; then
    ok "salteado por SKIP_IMPORT"
    return
  fi

  local existing docker_up=0
  existing="$(table_count)"

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
     && (cd "$ROOT" && docker compose ps --status running --services 2>/dev/null | grep -qx db); then
    docker_up=1
  fi

  # The dangerous state, and the reason this is a hard stop instead of a
  # skip: a stale `dforce_catalog` left over from an older run answers on
  # 5432 with the right table names and no rows. Silently keeping it looks
  # exactly like "the app lost all my data", and silently overwriting it is
  # destructive. Neither is the script's call to make.
  if [ "${existing:-0}" != "0" ]; then
    if [ "$docker_up" = "1" ]; then
      fail \
        "Hay DOS bases '$DB_NAME' y no sé cuál querés conservar:

  nativa (localhost:$PG_PORT)   → $existing tabla(s)
  Docker (localhost:$DOCKER_PG_PORT)  → $(docker_table_count) tabla(s)

No importo nada por mi cuenta: pisaría la nativa sin que lo pidas." \
        "Si la buena es la de Docker (lo normal si venías trabajando ahí),
traela encima de la nativa — hace un respaldo antes de tocar nada:

  docker compose exec -T db pg_dump -U $DB_USER -Fc $DB_NAME > /tmp/docker.dump
  ./scripts/standalone.sh restore /tmp/docker.dump

Si la buena es la nativa, decímelo y sigo con ella:

  SKIP_IMPORT=1 ./scripts/standalone.sh

Para comparar antes de decidir:

  psql -h localhost -p $PG_PORT -U $DB_USER -d $DB_NAME -c '\\dt'
  docker compose exec -T db psql -U $DB_USER -d $DB_NAME -c '\\dt'"
    fi
    ok "La base nativa ya tiene $existing tabla(s) — no toco nada"
    return
  fi

  if [ "$docker_up" != "1" ]; then
    ok "El contenedor 'db' no está levantado — arranco con una base vacía"
    note "si querés traer datos viejos: docker compose up -d db && ./scripts/standalone.sh"
    return
  fi

  mkdir -p "$BACKUP_DIR"
  local dump="$BACKUP_DIR/desde-docker-$(date +%Y%m%d-%H%M%S).dump"

  # -Fc (custom format) and not plain SQL: pg_restore can then be told to
  # continue past objects that already exist, and the file is compressed.
  # `exec -T` matters — with a TTY attached Docker mangles the binary stream.
  if ! (cd "$ROOT" && docker compose exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$dump") 2>/dev/null; then
    rm -f "$dump"
    fail \
      "El pg_dump dentro del contenedor falló, así que no puedo traer los datos viejos." \
      "Probalo a mano para ver el error completo:

  docker compose exec -T db pg_dump -U $DB_USER -Fc $DB_NAME > /tmp/d.dump

Si preferís empezar con una base vacía (los datos del contenedor quedan
intactos en su volumen):

  SKIP_IMPORT=1 ./scripts/standalone.sh"
  fi

  if [ ! -s "$dump" ]; then
    rm -f "$dump"
    fail \
      "El dump salió vacío — no traje nada y prefiero parar antes que seguir." \
      "Verificá que el contenedor tenga la base que creés:

  docker compose exec -T db psql -U $DB_USER -d $DB_NAME -c '\\dt'"
  fi

  RESTORE_OUT="$(pg_restore -h localhost -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner "$dump" 2>&1)"
  # pg_restore exits non-zero on ignorable noise too (extensions owned by the
  # superuser, comments). The check that actually matters is whether tables
  # landed, so that is what decides.
  if [ "$(table_count)" = "0" ]; then
    fail \
      "pg_restore no dejó ninguna tabla en la base nativa. Salida completa:

$RESTORE_OUT" \
      "El dump quedó guardado en:

  $dump

Podés reintentar solo la restauración:

  pg_restore -h localhost -p $PG_PORT -U $DB_USER -d $DB_NAME --no-owner '$dump'"
  fi
  ok "Importadas $(table_count) tabla(s) desde el contenedor"
  note "copia del dump: $dump"
}

# --------------------------------------------------------------------------
# .env
# --------------------------------------------------------------------------
# The single line that has to change. Patched in place with a timestamped
# backup instead of being printed as an instruction, because leaving it
# pointing at 5433 fails silently: with a Homebrew Postgres on 5432 the app
# connects fine, to the wrong database, and just looks empty.
ensure_env() {
  step "Archivo .env"

  [ -f "$ROOT/.env" ] || fail \
    "Falta .env — ni la app ni las migraciones arrancan sin él." \
    "cp env.example .env

Después corregí IFX_TOKEN y las claves de R2, y volvé a correr el script."

  DATABASE_URL="$(env_value "$ROOT/.env" DATABASE_URL)"
  [ -n "$DATABASE_URL" ] || fail \
    "DATABASE_URL no está definida en .env." \
    "Agregala:

  DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:$PG_PORT/$DB_NAME"

  case "$DATABASE_URL" in
    *":$PG_PORT/"*)
      ok "DATABASE_URL ya apunta a localhost:$PG_PORT"
      ;;
    *":$DOCKER_PG_PORT/"*)
      local backup="$ROOT/.env.bak-$(date +%Y%m%d-%H%M%S)"
      cp "$ROOT/.env" "$backup" || fail \
        "No pude respaldar .env antes de editarlo, así que no lo edité." \
        "Revisá permisos en $ROOT y reintentá."
      # Only the port inside DATABASE_URL is touched; every other line
      # (tokens, claves de R2) queda byte por byte igual.
      sed -i '' "s|\(^[[:space:]]*DATABASE_URL[[:space:]]*=.*:\)$DOCKER_PG_PORT/|\1$PG_PORT/|" "$ROOT/.env"
      DATABASE_URL="$(env_value "$ROOT/.env" DATABASE_URL)"
      case "$DATABASE_URL" in
        *":$PG_PORT/"*) ok "DATABASE_URL movida de $DOCKER_PG_PORT a $PG_PORT" ;;
        *) fail \
             "Intenté cambiar el puerto en .env y no quedó aplicado." \
             "Editalo a mano (tu .env original está en $backup):

  DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:$PG_PORT/$DB_NAME" ;;
      esac
      note "respaldo del .env anterior: $(basename "$backup")"
      ;;
    *)
      fail \
        "DATABASE_URL no apunta ni a $PG_PORT ni a $DOCKER_PG_PORT, así que no
adivino qué querías. No la toqué." \
        "Si querés el Postgres nativo de este script, dejala así:

  DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:$PG_PORT/$DB_NAME"
      ;;
  esac
}

# --------------------------------------------------------------------------
# Migrations + first user
# --------------------------------------------------------------------------
run_migrations() {
  step "Migraciones de Drizzle"

  [ -d "$ROOT/node_modules" ] || fail \
    "node_modules no existe — el proyecto no tiene sus dependencias." \
    "npm install"

  # scripts/migrate.mjs reads process.env directly and does NOT load .env —
  # only Next.js does. Exporting it here is what makes this work from a plain
  # shell at all.
  MIGRATE_OUT="$(cd "$ROOT" && DATABASE_URL="$DATABASE_URL" npm run --silent db:migrate 2>&1)" || fail \
    "Las migraciones fallaron. Salida completa:

$MIGRATE_OUT" \
    "Si el error es 'relation already exists', la base ya tenía el esquema
pero drizzle no lo registró. Mirá qué migraciones cree que corrió:

  psql -h localhost -p $PG_PORT -U $DB_USER -d $DB_NAME \\
    -c 'select id, created_at from drizzle.__drizzle_migrations order by id;'

Compará contra src/shared/db/migrations/meta/_journal.json. La tabla que
manda es drizzle.__drizzle_migrations — NO public.__drizzle_migrations."
  ok "Base de datos al día"
}

seed_first_user() {
  local count
  count="$(psql -h localhost -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc 'select count(*) from users;' 2>/dev/null | tr -d '[:space:]')"

  if [ "$count" = "0" ]; then
    local u="${DEV_USER:-admin}"
    local p="${DEV_PASSWORD:-admin123}"
    warn "La tabla users está vacía — creando el usuario inicial."
    SEED_OUT="$(cd "$ROOT" && DATABASE_URL="$DATABASE_URL" node scripts/seed-user.mjs "$u" "$p" administrador 2>&1)" || fail \
      "No pude crear el usuario inicial. Salida completa:

$SEED_OUT" \
      "Creá uno a mano:

  DATABASE_URL='$DATABASE_URL' \\
    node scripts/seed-user.mjs <usuario> <clave> administrador"
    ok "Usuario '$u' creado con rol administrador"
    [ "$p" = "admin123" ] && note "clave: admin123 — cambiala desde Mi cuenta"
  else
    ok "${count:-?} usuario(s) en la base"
  fi
}

# --------------------------------------------------------------------------
# Subcommands
# --------------------------------------------------------------------------
cmd_backup() {
  resolve_pg
  pg_up || fail \
    "Postgres no está corriendo, así que no hay nada de dónde sacar el backup." \
    "brew services start $PG_FORMULA

O corré el setup completo:

  ./scripts/standalone.sh --setup-only"

  mkdir -p "$BACKUP_DIR"
  local out="$BACKUP_DIR/$DB_NAME-$(date +%Y%m%d-%H%M%S).dump"

  DUMP_OUT="$(pg_dump -h localhost -p "$PG_PORT" -U "$DB_USER" -Fc "$DB_NAME" -f "$out" 2>&1)" || {
    rm -f "$out"
    fail \
      "pg_dump falló. Salida completa:

$DUMP_OUT" \
      "Verificá que la base exista y que el rol pueda leerla:

  psql -h localhost -p $PG_PORT -U $DB_USER -d $DB_NAME -c '\\dt'"
  }

  [ -s "$out" ] || { rm -f "$out"; fail \
    "El backup salió vacío — lo borré para que no parezca un respaldo válido." \
    "Verificá que la base tenga datos:

  psql -h localhost -p $PG_PORT -U $DB_USER -d $DB_NAME -c '\\dt'"; }

  ok "Backup: $out ($(du -h "$out" | cut -f1))"
  note "restaurarlo: ./scripts/standalone.sh restore '$out'"
}

cmd_restore() {
  local file="${1:-}"
  [ -n "$file" ] || fail \
    "No me pasaste qué archivo restaurar." \
    "./scripts/standalone.sh restore <archivo.dump>

Los backups viven en $BACKUP_DIR:

  ls -lh '$BACKUP_DIR'"

  [ -f "$file" ] || fail \
    "No existe el archivo '$file'." \
    "ls -lh '$BACKUP_DIR'"

  resolve_pg
  pg_up || fail \
    "Postgres no está corriendo, no hay dónde restaurar." \
    "brew services start $PG_FORMULA"

  ensure_role_and_db

  # A restore overwrites live data, so the current state is dumped first. This
  # is the difference between a bad restore being an inconvenience and being
  # the incident.
  if [ "$(table_count)" != "0" ]; then
    warn "La base '$DB_NAME' tiene datos y la restauración los reemplaza."
    if [ -z "${FORCE:-}" ]; then
      if [ ! -t 0 ]; then
        fail \
          "Restauración destructiva sin terminal para confirmar." \
          "Corrélo desde una terminal, o asumí el riesgo explícitamente:

  FORCE=1 ./scripts/standalone.sh restore '$file'"
      fi
      printf '\n  Escribí %ssi%s para continuar: ' "$RED" "$OFF"
      read -r answer
      [ "$answer" = "si" ] || fail \
        "Cancelado — no toqué nada." \
        "Si querés seguir, escribí exactamente 'si' cuando pregunte."
    fi
    printf '\n'
    step "Respaldo previo por las dudas"
    cmd_backup
  fi

  step "Restaurando"
  # --clean --if-exists so a restore over an existing schema replaces it
  # instead of colliding object by object.
  RESTORE_OUT="$(pg_restore -h localhost -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --no-owner "$file" 2>&1)"
  if [ "$(table_count)" = "0" ]; then
    fail \
      "La restauración no dejó ninguna tabla. Salida completa:

$RESTORE_OUT" \
      "Verificá que el archivo sea un dump de formato custom (-Fc):

  pg_restore -l '$file' | head"
  fi
  ok "Restauradas $(table_count) tabla(s) desde $(basename "$file")"
}

cmd_status() {
  resolve_pg
  step "Estado"

  if pg_up; then
    ok "Postgres arriba en localhost:$PG_PORT"
    local t
    t="$(table_count)"
    if [ -n "$t" ]; then
      ok "Base '$DB_NAME': $t tabla(s)"
    else
      warn "La base '$DB_NAME' no existe todavía (o el rol no puede leerla)"
    fi
  else
    warn "Postgres NO está corriendo (brew services start $PG_FORMULA)"
  fi

  note "datos:   $PG_DATA_DIR"
  note "log:     $PG_LOG"
  note "backups: $BACKUP_DIR"

  if [ -f "$ROOT/.env" ]; then
    case "$(env_value "$ROOT/.env" DATABASE_URL)" in
      *":$PG_PORT/"*)        ok ".env apunta al Postgres nativo ($PG_PORT)" ;;
      *":$DOCKER_PG_PORT/"*) warn ".env todavía apunta al Postgres de Docker ($DOCKER_PG_PORT)" ;;
      *)                     warn ".env apunta a un Postgres que no es ninguno de los dos" ;;
    esac
  else
    warn "No hay .env"
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
     && (cd "$ROOT" && docker compose ps --status running --services 2>/dev/null | grep -qx db); then
    warn "El contenedor 'db' sigue levantado — ya no hace falta (docker compose stop db)"
  fi
}

cmd_start() {
  local mode="$1"  # prod | dev | setup-only

  step "Prerrequisitos"
  for c in npm node; do
    command -v "$c" >/dev/null 2>&1 || fail \
      "No encontré el comando '$c' en el PATH." \
      "nvm use 22   (o instalá Node 20+)"
  done
  ok "npm y node disponibles"

  if [ "$mode" != "setup-only" ] && lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail \
      "El puerto $APP_PORT ya está ocupado, la app no va a poder arrancar." \
      "Mirá quién lo tiene:

  lsof -nP -iTCP:$APP_PORT -sTCP:LISTEN

Si es una corrida vieja de este mismo stack, matala:

  kill \$(lsof -tnP -iTCP:$APP_PORT -sTCP:LISTEN)

O usá otro puerto:

  APP_PORT=<puerto> ./scripts/standalone.sh"
  fi

  resolve_pg
  start_postgres
  ensure_role_and_db
  import_from_docker
  ensure_env
  run_migrations
  seed_first_user

  if [ "$mode" = "setup-only" ]; then
    printf '\n%s✓ Todo listo.%s La base vive en:\n\n    %s\n\n' "$GREEN" "$OFF" "$PG_DATA_DIR"
    printf '  Arrancar la app:  npm run build && npm start\n'
    printf '  Backup:           ./scripts/standalone.sh backup\n\n'
    return 0
  fi

  APP_PID=''
  cleanup() {
    trap - EXIT INT TERM
    if [ -n "$APP_PID" ]; then
      printf '\n%sBajando la app...%s\n' "$DIM" "$OFF"
      kill "$APP_PID" 2>/dev/null
      wait 2>/dev/null
      printf '%sListo. Postgres sigue arriba como servicio de Homebrew.%s\n' "$DIM" "$OFF"
    fi
  }
  trap 'cleanup; exit 0' INT TERM
  trap cleanup EXIT

  if [ "$mode" = "prod" ]; then
    step "Compilando"
    BUILD_OUT="$(cd "$ROOT" && npm run --silent build 2>&1)" || fail \
      "El build de Next falló. Salida completa:

$BUILD_OUT" \
      "Arreglá los errores de arriba. Para levantar igual y debuggear:

  ./scripts/standalone.sh --dev"
    ok "Build listo"
  fi

  step "Arrancando la app"
  if [ "$mode" = "prod" ]; then
    (cd "$ROOT" && exec npm run start -- --port "$APP_PORT") &
  else
    (cd "$ROOT" && exec npm run dev -- --port "$APP_PORT") &
  fi
  APP_PID=$!

  printf '\n  App  → %shttp://localhost:%s%s\n' "$GREEN" "$APP_PORT" "$OFF"
  printf '  Data → %s%s%s\n' "$DIM" "$PG_DATA_DIR" "$OFF"
  printf '\n  %sCtrl-C la baja. Postgres queda corriendo.%s\n\n' "$DIM" "$OFF"

  wait "$APP_PID" 2>/dev/null
  DIED_CODE=$?
  printf '\n%s✗ La app se murió (exit %s). El error está en el log de arriba.%s\n' "$RED" "$DIED_CODE" "$OFF" >&2
  exit 1
}

# --------------------------------------------------------------------------
# Argument dispatch
# --------------------------------------------------------------------------
case "${1:-}" in
  backup)  shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  status)  shift; cmd_status "$@" ;;
  --dev)         cmd_start dev ;;
  --setup-only)  cmd_start setup-only ;;
  -h|--help)
    sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
  '')      cmd_start prod ;;
  *)
    fail \
      "No conozco la opción '$1'." \
      "./scripts/standalone.sh --help"
    ;;
esac
