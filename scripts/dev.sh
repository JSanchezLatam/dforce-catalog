#!/usr/bin/env bash
#
# Bring up the full local stack: Postgres (docker), Drizzle migrations, and
# the Next.js app in dev mode.
#
# Orchestrator only: it never installs dependencies and never writes .env
# files. When a prerequisite is missing it prints exactly what is wrong and
# the exact command that fixes it, then exits non-zero.
#
# Usage:  ./scripts/dev.sh
# Env:    APP_PORT (default 3000), SKIP_TYPECHECK=1 to skip the tsc gate

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
# The host port docker-compose.yml publishes for the `db` service.
DB_HOST_PORT=5433

if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; BLUE=''; DIM=''; OFF=''
fi

step() { printf '\n%s▸ %s%s\n' "$BLUE" "$1" "$OFF"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$RED" "$OFF" "$1"; }

# fail <what is wrong> <how to fix it>
fail() {
  printf '\n%s✗ %s%s\n\n' "$RED" "$1" "$OFF" >&2
  printf '  Cómo arreglarlo:\n\n' >&2
  printf '%s\n' "$2" | sed 's/^/    /' >&2
  printf '\n' >&2
  exit 1
}

# --------------------------------------------------------------------------
# 1. Prerequisites
# --------------------------------------------------------------------------
step "Verificando prerrequisitos"

for cmd in docker npm; do
  command -v "$cmd" >/dev/null 2>&1 || fail \
    "No encontré el comando '$cmd' en el PATH." \
    "Instalalo y volvé a correr este script.
docker → Docker Desktop (https://docker.com)
npm    → nvm use 22   (o instalá Node 20+)"
done
ok "docker y npm disponibles"

docker info >/dev/null 2>&1 || fail \
  "Docker está instalado pero el daemon no responde." \
  "Abrí Docker Desktop desde Applications y esperá a que el ícono
de la barra de menú deje de animarse. Después:

  ./scripts/dev.sh"
ok "Docker daemon respondiendo"

# Checked before pulling images and running migrations: failing on a busy port
# afterwards wastes minutes on a problem knowable in the first second.
if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail \
    "El puerto $APP_PORT ya está ocupado, la app no va a poder arrancar." \
    "Mirá quién lo tiene:

  lsof -nP -iTCP:$APP_PORT -sTCP:LISTEN

Si es una corrida vieja de este mismo stack, matala:

  kill \$(lsof -tnP -iTCP:$APP_PORT -sTCP:LISTEN)

O corré este script en otro puerto:

  APP_PORT=<puerto> ./scripts/dev.sh"
fi
ok "Puerto $APP_PORT libre"

# --------------------------------------------------------------------------
# 2. Env file (existence and one shape check — never printed, never leaked)
# --------------------------------------------------------------------------
step "Verificando archivo de entorno"

[ -f "$ROOT/.env" ] || fail \
  "Falta .env — ni la app ni las migraciones arrancan sin él." \
  "cp env.example .env

Después revisá que IFX_TOKEN y las claves de R2 sean las tuyas."
ok ".env presente"

# Reads only the KEY=value shape, never echoes a value.
env_value() {
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" \
    | tail -1 \
    | tr -d '"'\''' \
    | tr -d '\r' \
    | sed 's/[[:space:]]*$//'
}

DATABASE_URL="$(env_value "$ROOT/.env" DATABASE_URL)"

[ -n "$DATABASE_URL" ] || fail \
  "DATABASE_URL no está definida en .env." \
  "Agregala:

  DATABASE_URL=postgres://dforce:dforce@localhost:$DB_HOST_PORT/dforce_catalog"

# The exact mismatch that made the documented setup a lie: docker-compose
# publishes Postgres on 5433, but .env shipped pointing at 5432 — where a
# Homebrew Postgres usually answers. Everything connects, and every query hits
# the wrong (empty) database.
case "$DATABASE_URL" in
  *:"$DB_HOST_PORT"/*) ok "DATABASE_URL apunta al puerto $DB_HOST_PORT" ;;
  *)
    fail \
      "DATABASE_URL en .env NO apunta al puerto $DB_HOST_PORT, que es donde
docker-compose publica Postgres. Si tenés un Postgres propio en 5432 esto no
falla: conecta igual, contra la base equivocada, y la app se ve vacía." \
      "Cambiá el puerto en .env:

  DATABASE_URL=postgres://dforce:dforce@localhost:$DB_HOST_PORT/dforce_catalog"
    ;;
esac

# --------------------------------------------------------------------------
# 3. Dependencies (checked, never installed)
# --------------------------------------------------------------------------
step "Verificando dependencias instaladas"

[ -d "$ROOT/node_modules" ] || fail \
  "node_modules no existe — el proyecto no tiene sus dependencias." \
  "npm install"
ok "Dependencias instaladas"

# --------------------------------------------------------------------------
# 4. Types
# --------------------------------------------------------------------------
# `lint` is eslint and `test` is vitest — neither looks at types. Without this
# gate a change that does not compile still starts, renders, and silently does
# nothing. A few seconds here buys back that whole class of regression.
step "Verificando tipos"

if [ -n "${SKIP_TYPECHECK:-}" ]; then
  warn "salteado por SKIP_TYPECHECK"
else
  TSC_OUT="$(cd "$ROOT" && npx tsc --noEmit 2>&1)" || fail \
    "El proyecto no compila. TypeScript encontró esto:

$TSC_OUT" \
    "Arreglá los errores de arriba (te dan archivo y línea).

Si necesitás levantar igual para debuggear, saltealo por esta vez:

  SKIP_TYPECHECK=1 ./scripts/dev.sh"
  ok "Tipos en verde"
fi

# --------------------------------------------------------------------------
# 5. Infrastructure
# --------------------------------------------------------------------------
step "Levantando Postgres"

# Output not captured on purpose: the first run pulls the postgres image and
# swallowing that makes the script look frozen. Docker's own error text stays
# on screen when it fails.
(cd "$ROOT" && docker compose up -d db) || fail \
  "docker compose up falló — el error de Docker está impreso arriba." \
  "Si dice 'port is already allocated', algo más tiene el $DB_HOST_PORT:

  lsof -nP -iTCP:$DB_HOST_PORT -sTCP:LISTEN

Si dice 'no space left on device':

  docker system prune -a"
ok "Contenedor arriba"

printf '  esperando a que Postgres acepte conexiones'
WAITED=0
until (cd "$ROOT" && docker compose exec -T db pg_isready -U dforce -d dforce_catalog >/dev/null 2>&1); do
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge 60 ]; then
    printf '\n'
    fail \
      "Postgres no aceptó conexiones después de 60 segundos." \
      "Mirá qué está pasando adentro del contenedor:

  docker compose logs db

Si la data quedó corrupta, el reset destructivo (BORRA TODO) es:

  docker compose down -v && docker compose up -d db"
  fi
  printf '.'
  sleep 1
done
printf '\n'
ok "Postgres listo"

# --------------------------------------------------------------------------
# 6. Migrations
# --------------------------------------------------------------------------
step "Aplicando migraciones de Drizzle"

# scripts/migrate.mjs reads process.env directly and does NOT load .env — only
# Next.js and the compose services do. Exporting it here is what makes
# `npm run db:migrate` work from a plain shell at all.
MIGRATE_OUT="$(cd "$ROOT" && DATABASE_URL="$DATABASE_URL" npm run --silent db:migrate 2>&1)" || fail \
  "Las migraciones fallaron. Salida completa:

$MIGRATE_OUT" \
  "Si el error es de un enum que ya fue renombrado ('RenameEnumLabel'), la
base ya tiene el cambio aplicado pero drizzle no lo registró. Mirá qué
migraciones cree que corrió:

  docker compose exec db psql -U dforce -d dforce_catalog \\
    -c 'select id, created_at from drizzle.__drizzle_migrations order by id;'

Compará contra src/shared/db/migrations/meta/_journal.json. La tabla que
manda es drizzle.__drizzle_migrations — NO public.__drizzle_migrations, que
es un resto de un arreglo manual viejo y no la lee nadie."
ok "Base de datos al día"

# An empty users table looks exactly like a broken login. Cheap to detect,
# confusing to debug — so say it here rather than at the login screen.
USER_COUNT="$(cd "$ROOT" && docker compose exec -T db psql -U dforce -d dforce_catalog -tAc 'select count(*) from users;' 2>/dev/null | tr -d '[:space:]')"
if [ "$USER_COUNT" = "0" ]; then
  warn "La tabla users está vacía — no vas a poder iniciar sesión."
  printf '    Creá uno con: %snpm run db:seed-user%s\n' "$DIM" "$OFF"
else
  ok "${USER_COUNT} usuario(s) en la base"
fi

# --------------------------------------------------------------------------
# 7. Application process
# --------------------------------------------------------------------------
APP_PID=''

cleanup() {
  trap - EXIT INT TERM
  # Nothing launched yet means this is a failed precondition, not a shutdown —
  # announcing "bajando procesos" there is just noise on top of the real error.
  if [ -n "$APP_PID" ]; then
    printf '\n%sBajando la app...%s\n' "$DIM" "$OFF"
    kill "$APP_PID" 2>/dev/null
    wait 2>/dev/null
    printf '%sListo. Postgres sigue arriba (docker compose down para pararlo).%s\n' "$DIM" "$OFF"
  fi
}
# On a signal, cleanup must end the script. Without the explicit exit, bash
# resumes the wait below once the handler returns and reports a clean Ctrl-C
# as a crash.
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

step "Arrancando la app"

(cd "$ROOT" && exec npm run dev -- --port "$APP_PORT") &
APP_PID=$!

printf '\n  App  → %shttp://localhost:%s%s\n' "$GREEN" "$APP_PORT" "$OFF"
printf '\n  %sCtrl-C la baja.%s\n\n' "$DIM" "$OFF"

wait "$APP_PID" 2>/dev/null
DIED_CODE=$?
printf '\n%s✗ La app se murió (exit %s). El error está en el log de Next.js de arriba.%s\n' "$RED" "$DIED_CODE" "$OFF" >&2
exit 1
