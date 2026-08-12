#!/usr/bin/env bash
#
# Drain the pg-boss `pdf-generate` queue before deploying.
#
# WHY THIS EXISTS
#   The catalog-templates-and-workshop-info change altered the queue payload
#   shape twice:
#     - WU3 replaced the old branding fields with `PdfBranding`
#     - WU4 replaced the scalar `price` with three-tier `prices`
#   A job enqueued BEFORE the deploy and picked up by the NEW worker fails
#   inside a decoupled pg-boss process with nobody to report the error to.
#   The user sees a catalog that never arrives and no message explaining why.
#
# WHEN TO RUN IT
#   After stopping the old worker, before starting the new one. Not during
#   normal operation — this discards queued work.
#
# USAGE
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/drain-pdf-queue.sh
#   Add --yes to skip the confirmation prompt (for a scripted deploy).
#
set -euo pipefail

QUEUE="pdf-generate"
ASSUME_YES=0
[[ "${1:-}" == "--yes" ]] && ASSUME_YES=1

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  echo "This script never guesses a target — draining the wrong database" >&2
  echo "silently destroys queued work. Set it explicitly." >&2
  exit 1
fi

# Show the target without leaking the password into logs or terminal history.
SAFE_TARGET="$(printf '%s' "$DATABASE_URL" | sed -E 's#://[^:]+:[^@]+@#://***:***@#')"
echo "Target: $SAFE_TARGET"
echo

# Look before deleting. States that occupy a queue slot are the ones that a
# new worker would pick up; `completed`/`failed`/`cancelled` are already done
# and must not be touched — they are the audit trail.
echo "Current $QUEUE jobs by state:"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  SELECT state, count(*) AS jobs
  FROM pgboss.job
  WHERE name = '$QUEUE'
  GROUP BY state
  ORDER BY state;
"

PENDING="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT count(*) FROM pgboss.job
  WHERE name = '$QUEUE' AND state IN ('created','retry','active');
")"

if [[ "$PENDING" -eq 0 ]]; then
  echo "Nothing to drain: 0 jobs in created/retry/active."
  echo "Safe to deploy."
  exit 0
fi

echo
echo "$PENDING job(s) would be picked up by the new worker and fail."
echo "They carry the pre-deploy payload shape and cannot be migrated —"
echo "the catalog they describe has to be regenerated from the UI."
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Cancel these $PENDING job(s)? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted. Nothing changed."; exit 1; }
fi

# Cancel rather than DELETE: pg-boss keeps the row, so the jobs stay visible
# in the audit trail as deliberately cancelled instead of vanishing.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  UPDATE pgboss.job
  SET state = 'cancelled', completed_on = now()
  WHERE name = '$QUEUE' AND state IN ('created','retry','active');
"

REMAINING="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "
  SELECT count(*) FROM pgboss.job
  WHERE name = '$QUEUE' AND state IN ('created','retry','active');
")"

if [[ "$REMAINING" -ne 0 ]]; then
  echo "ERROR: $REMAINING job(s) still pending after the drain." >&2
  echo "Do NOT start the new worker. Investigate first." >&2
  exit 1
fi

echo
echo "Drained. 0 jobs remain in created/retry/active."
echo "Safe to start the new worker."
