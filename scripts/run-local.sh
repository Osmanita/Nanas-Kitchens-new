#!/usr/bin/env bash
set -euo pipefail

# Starts one clean Java API + one clean Next.js web app. Stop both with Ctrl+C.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

API_PORT="${JAVA_API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-3010}"

require_free_port() {
  local port="$1"
  local service="$2"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$service cannot start: port $port is already in use (PID: ${pids//$'\n'/, })." >&2
    echo "Stop the existing process first, then run pnpm dev:local again." >&2
    exit 1
  fi
}

# Check before deleting output: an old process plus newly compiled classes can cause
# NoSuchMethodError-style mixed-version failures.
require_free_port "$API_PORT" "Java API"
require_free_port "$WEB_PORT" "Web app"

bash "$ROOT/scripts/clean-local-builds.sh"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT/apps/api-java" && JAVA_API_PORT="$API_PORT" ./mvnw spring-boot:run) &
API_PID=$!

(cd "$ROOT/apps/web" && WATCHPACK_POLLING=true npm run dev -- -p "$WEB_PORT") &
WEB_PID=$!

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

# Return the failed process's exit status; the EXIT trap stops its sibling.
if ! kill -0 "$API_PID" 2>/dev/null; then
  wait "$API_PID"
else
  wait "$WEB_PID"
fi
