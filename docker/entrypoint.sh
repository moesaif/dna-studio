#!/bin/sh
# Entrypoint for the DNA Studio app container.
#
# Applies pending Prisma migrations, then starts the Next.js server.
#
# Only *transient* failures — the database not being reachable yet — are
# retried, and only a bounded number of times. A deterministic failure such as
# a broken migration or a blocked migration history (P3009) exits non-zero
# immediately with the real Prisma output, instead of being retried forever
# behind a misleading "Database not ready" message. See issue #9.

set -eu

# Overridable so the retry logic can be exercised without a real database.
PRISMA="${PRISMA_CMD:-node node_modules/prisma/build/index.js}"
SERVER_CMD="${SERVER_CMD:-node server.js}"
MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-10}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY:-5}"

# Prisma error codes meaning "the database is not reachable *yet*":
#   P1001 can't reach database server
#   P1002 database server reached but timed out
#   P1017 server has closed the connection
# Every other code is a real failure that will not fix itself on retry.
is_transient() {
  printf '%s' "$1" | grep -qE 'P1001|P1002|P1017'
}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if output="$($PRISMA migrate deploy 2>&1)"; then
    printf '%s\n' "$output"
    echo "==> Migrations applied. Starting server."
    exec $SERVER_CMD
  fi

  if is_transient "$output"; then
    echo "==> Database not reachable yet (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY}s..."
    attempt=$((attempt + 1))
    sleep "$RETRY_DELAY"
    continue
  fi

  # Deterministic failure: surface it and stop.
  printf '%s\n' "$output" >&2
  echo "" >&2
  echo "==> Migration failed and will not succeed on retry. Aborting." >&2

  case "$output" in
    *P3009*)
      cat >&2 <<'HINT'

A previous migration is recorded as failed, which blocks all further migrations.
Inspect the history with:

    docker compose exec app node node_modules/prisma/build/index.js migrate status

If the failed migration made no changes (Postgres rolls each migration back on
error), clear the record with:

    docker compose exec app node node_modules/prisma/build/index.js migrate resolve --rolled-back <migration_name>

Or, if the database holds nothing you need, start clean:

    docker compose down -v && docker compose up -d
HINT
      ;;
  esac

  exit 1
done

echo "==> Database still unreachable after ${MAX_ATTEMPTS} attempts. Aborting." >&2
exit 1
