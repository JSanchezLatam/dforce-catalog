#!/usr/bin/env bash
#
# The command launchd runs for com.dforce.catalog. Nothing else should call it.
#
# Why this exists instead of pointing the plist at standalone.sh: that script
# runs migrations, builds, and — the part that matters here — installs
# `trap cleanup EXIT`, which kills the app process it just started. It is a
# setup script meant to be watched from a terminal, not a service entrypoint.
#
# This file's only job is to not start the app before its database exists.
# Postgres is a separate user LaunchAgent (Homebrew's), so at login both jobs
# start at the same time, and losing that race is NOT a crash launchd can fix:
# measured on this machine, `next start` against a refused Postgres keeps
# listening and answers every request with a 500, logging only
# "An error occurred while loading instrumentation hook" — instrumentation.ts
# registers the pg-boss workers at boot, and that is the half with no database.
# launchd sees a healthy process and leaves it there, serving 500s, forever.
#
# Supervision itself is launchd's job (KeepAlive), not this script's — there is
# deliberately no retry loop around the app below.
#
# Env: APP_PORT (default 3000), PG_FORMULA (default postgresql@17),
#      PG_HOST / PG_PORT (default: whatever .env's DATABASE_URL says),
#      PG_WAIT_SECONDS (default 60)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
PG_FORMULA="${PG_FORMULA:-postgresql@17}"
PG_WAIT_SECONDS="${PG_WAIT_SECONDS:-60}"

# Everything this script prints lands in ~/Library/Logs/dforce-catalog.log,
# which is the only place anyone will ever read it from — so every line is
# timestamped and says what to do about itself.
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }

# Which Postgres to wait for is read out of DATABASE_URL, never assumed to be
# the native 5432: this repo's .env legitimately points at 5433 (the compose
# container) on any machine that still has Docker, and waiting on 5432 there
# means waiting on a server the app is not going to use. Same KEY=value-only
# read as standalone.sh's env_value — a value is never echoed.
db_url="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" 2>/dev/null \
  | tail -1 | tr -d '"'\''' | tr -d '\r' | sed 's/[[:space:]]*$//')"
hostport="${db_url##*@}"   # strip user:password@
hostport="${hostport%%/*}" # strip /database?params
url_host="${hostport%%:*}"
url_port="${hostport##*:}"
case "$url_port" in
  ''|*[!0-9]*) url_port='' ;;  # no :port in the URL, or not a number
esac

PG_HOST="${PG_HOST:-${url_host:-localhost}}"
PG_PORT="${PG_PORT:-${url_port:-5432}}"

# pg_isready comes from a keg-only formula, so it is NOT in /opt/homebrew/bin
# and never on launchd's PATH. brew is, which is how it gets resolved.
PG_ISREADY="$(command -v pg_isready 2>/dev/null || true)"
if [ ! -x "$PG_ISREADY" ] && command -v brew >/dev/null 2>&1; then
  PG_ISREADY="$(brew --prefix "$PG_FORMULA" 2>/dev/null)/bin/pg_isready"
fi

if [ ! -x "$PG_ISREADY" ]; then
  log "No encontré pg_isready de $PG_FORMULA, así que no puedo esperar a la base."
  log "Arranco igual, pero si la base no está, la app va a contestar 500 a todo."
  log "Cómo arreglarlo:  brew install $PG_FORMULA"
else
  log "Esperando a Postgres en $PG_HOST:$PG_PORT (hasta ${PG_WAIT_SECONDS}s)."
  waited=0
  until "$PG_ISREADY" -h "$PG_HOST" -p "$PG_PORT" -q >/dev/null 2>&1; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$PG_WAIT_SECONDS" ]; then
      log "Postgres no aceptó conexiones en $PG_HOST:$PG_PORT en ${PG_WAIT_SECONDS}s."
      log "No arranco la app: arrancaría y contestaría 500 a todo sin decir por qué."
      log "Cómo arreglarlo:  brew services start $PG_FORMULA"
      log "(si DATABASE_URL apunta a $PG_PORT, el que tiene que estar arriba es ese)"
      exit 1
    fi
    sleep 1
  done
  log "Postgres responde en $PG_HOST:$PG_PORT."
fi

cd "$ROOT" || { log "No pude entrar a $ROOT — ¿se movió el repo?"; exit 1; }
log "Arrancando la app en el puerto $APP_PORT."
exec npm run start -- --port "$APP_PORT"
