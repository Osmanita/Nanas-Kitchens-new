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

bash "$ROOT/scripts/clean-local-builds.sh"

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT/apps/api-java" && JAVA_API_PORT="${JAVA_API_PORT:-8080}" ./mvnw spring-boot:run) &
API_PID=$!

(cd "$ROOT/apps/web" && WATCHPACK_POLLING=true npm run dev -- -p "${WEB_PORT:-3010}") &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"
