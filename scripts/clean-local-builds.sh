#!/usr/bin/env bash
set -euo pipefail

# Removes only generated local build output. Source code, dependencies and .env are preserved.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf \
  "$ROOT/apps/api-java/target" \
  "$ROOT/apps/web/.next" \
  "$ROOT/apps/mobile/.gradle" \
  "$ROOT/apps/mobile/build" \
  "$ROOT/apps/mobile/composeApp/build"

echo "Generated local build output removed."
