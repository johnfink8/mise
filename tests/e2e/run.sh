#!/usr/bin/env bash
# Orchestrates the dockerized e2e suite. Brings up the stack with --wait so
# postgres/aimock/fake-plex/mise-app are all healthy (and migrate-test has
# completed) before invoking playwright. The migrate-test container is a
# one-shot that exits 0; using --abort-on-container-exit instead would tear
# the whole stack down the moment migrate-test finished, never running the
# tests.
set -uo pipefail

cd "$(dirname "$0")/../.."

COMPOSE=(docker compose -f docker-compose.test.yml)
LOG_DIR=".tmp/e2e-logs"
mkdir -p "$LOG_DIR" .tmp/playwright-results

dump_logs() {
  # playwright runs via `compose run --rm` so its output is captured via tee
  # at the call site, not via compose logs (the container is gone by here).
  for svc in postgres-test migrate-test aimock fake-plex mise-app; do
    "${COMPOSE[@]}" logs --no-color --no-log-prefix "$svc" >"$LOG_DIR/$svc.log" 2>&1 || true
  done
  echo "container logs written to $LOG_DIR/" >&2
}

cleanup() {
  dump_logs
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${COMPOSE[@]}" up -d --build --wait \
  postgres-test migrate-test aimock fake-plex mise-app
up_code=$?
if [ $up_code -ne 0 ]; then
  echo "stack failed to come up (exit $up_code)" >&2
  exit $up_code
fi

# Tee the runner's stdout to .tmp/e2e-logs/playwright.log too — `compose run`
# doesn't route through compose's container-logs collector, so dump_logs leaves
# playwright.log empty otherwise. pipefail propagates the runner's exit code.
"${COMPOSE[@]}" run --rm \
  -v "$(pwd)/.tmp/playwright-results:/app/test-results" \
  -v "$(pwd)/.tmp/playwright-results:/app/playwright-report" \
  playwright 2>&1 | tee "$LOG_DIR/playwright.log"
exit ${PIPESTATUS[0]}
