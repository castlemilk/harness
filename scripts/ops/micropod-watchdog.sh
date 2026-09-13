#!/usr/bin/env bash
#
# Periodic Micropod health check. Detect-only: never mutates the runtime.
# Writes the latest JSON to $OMEGA_STORAGE_ROOT/recovery/micropod/health.json,
# appends a one-line status to health.log, and on an unhealthy result appends an
# alert and posts a macOS notification. Install with:
#
#   scripts/ops/install-micropod-watchdog.sh install
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${OMEGA_STORAGE_ROOT:-$HOME/.omega}/recovery/micropod"
mkdir -p "$OUT_DIR"

JSON="$(node "$ROOT/scripts/ops/micropod-health.mjs" --json 2>/dev/null || true)"
STATUS="$(printf '%s' "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","unknown"))' 2>/dev/null || echo unknown)"
REMEDY="$(printf '%s' "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("remedy") or "")' 2>/dev/null || echo "")"

printf '%s\n' "$JSON" > "$OUT_DIR/health.json"
printf '%s %s\n' "$(date -u +%FT%TZ)" "$STATUS" >> "$OUT_DIR/health.log"

if [ -f "$OUT_DIR/health.log" ]; then
  tail -n 2000 "$OUT_DIR/health.log" > "$OUT_DIR/health.log.tmp" 2>/dev/null \
    && mv "$OUT_DIR/health.log.tmp" "$OUT_DIR/health.log"
fi

if [ "$STATUS" != "healthy" ]; then
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$STATUS" "$REMEDY" >> "$OUT_DIR/alerts.log"
  osascript -e "display notification \"micropod: $STATUS\" with title \"Omega micropod watchdog\" subtitle \"${REMEDY:-see docs/micropod-recovery.md}\"" >/dev/null 2>&1 || true
fi