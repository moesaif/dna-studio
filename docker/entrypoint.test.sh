#!/bin/sh
# Tests for docker/entrypoint.sh — see issue #9.
#
# Drives the entrypoint with a fake `prisma` and a fake server so the retry
# policy can be checked without a database or a container.
#
# Usage: sh docker/entrypoint.test.sh

set -eu

ENTRYPOINT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/entrypoint.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

cat > fake-prisma.sh <<'FAKE'
#!/bin/sh
n=$(cat ./attempts 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > ./attempts
case "$FAKE_MODE" in
  ok)    echo "All migrations have been successfully applied."; exit 0 ;;
  flaky) if [ "$n" -lt 3 ]; then
           echo "Error: P1001 Can't reach database server at db:5432"; exit 1
         else
           echo "All migrations have been successfully applied."; exit 0
         fi ;;
  p3009) echo "Error: P3009"; echo "migrate found failed migrations in the target database"; exit 1 ;;
  p3018) echo "Error: P3018"; echo 'ERROR: relation "User" does not exist'; exit 1 ;;
  down)  echo "Error: P1001 Can't reach database server at db:5432"; exit 1 ;;
esac
FAKE
chmod +x fake-prisma.sh

printf '#!/bin/sh\necho SERVER_STARTED\n' > fake-server.sh
chmod +x fake-server.sh

failures=0

# run <mode> <max_attempts> -> writes output to ./out, exit code to ./code,
# prisma invocation count to ./attempts
run() {
  rm -f ./attempts
  set +e
  FAKE_MODE="$1" PRISMA_CMD="./fake-prisma.sh" SERVER_CMD="./fake-server.sh" \
    MIGRATE_MAX_ATTEMPTS="$2" MIGRATE_RETRY_DELAY=0 \
    sh "$ENTRYPOINT" > ./out 2>&1
  echo $? > ./code
  set -e
}

check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok   - $1"
  else
    echo "  FAIL - $1 (expected '$2', got '$3')"
    failures=$((failures + 1))
  fi
}

contains() { # contains <description> <needle>
  if grep -q -- "$2" ./out; then
    echo "  ok   - $1"
  else
    echo "  FAIL - $1 (output did not contain '$2')"
    failures=$((failures + 1))
  fi
}

echo "1. migrations succeed -> server starts"
run ok 4
check "exits 0"            0 "$(cat ./code)"
check "runs prisma once"   1 "$(cat ./attempts)"
contains "starts the server" "SERVER_STARTED"

echo "2. database slow to accept connections -> retries, then starts"
run flaky 4
check "exits 0"            0 "$(cat ./code)"
check "retries until ready" 3 "$(cat ./attempts)"
contains "starts the server" "SERVER_STARTED"

echo "3. blocked migration history (P3009) -> fails fast, no retry"
run p3009 4
check "exits non-zero"     1 "$(cat ./code)"
check "does not retry"     1 "$(cat ./attempts)"
contains "surfaces the Prisma error code" "P3009"
contains "explains recovery"              "migrate resolve --rolled-back"
contains "does not claim the db is down"  "will not succeed on retry"

echo "4. broken migration (P3018) -> fails fast, no retry"
run p3018 4
check "exits non-zero"     1 "$(cat ./code)"
check "does not retry"     1 "$(cat ./attempts)"
contains "surfaces the real database error" 'relation "User" does not exist'

echo "5. database never reachable -> bounded retries, then gives up"
run down 3
check "exits non-zero"          1 "$(cat ./code)"
check "stops after max attempts" 3 "$(cat ./attempts)"
contains "reports giving up" "still unreachable after 3 attempts"

echo
if [ "$failures" -eq 0 ]; then
  echo "All entrypoint tests passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
