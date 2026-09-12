#!/usr/bin/env bash
#
# Build + boot the harness in Docker and run the cuttlefish hello-world e2e.
#
#   scripts/e2e/docker-e2e.sh              # up, test, tear down
#   KEEP=1 scripts/e2e/docker-e2e.sh       # leave the stack running
#   OMEGA_PORT=4100 scripts/e2e/docker-e2e.sh
#
# Cuttlefish is expected to be running separately (its own Docker daemon):
#   (cd ../cuttlefish && make up)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

OMEGA_PORT="${OMEGA_PORT:-4000}"
CUTTLEFISH_API_URL="${CUTTLEFISH_API_URL:-http://127.0.0.1:4444}"
# From inside the harness container, cuttlefish lives on the host.
RUNTIME_BASE_URL="${RUNTIME_BASE_URL:-http://host.docker.internal:4444}"
# Restart cuttlefish with OTLP tracing (to the harness collector) so the e2e
# produces a cross-system trace. Set 0 to skip the restart and trace assertions.
CUTTLEFISH_OTEL="${CUTTLEFISH_OTEL:-1}"
KEEP="${KEEP:-0}"

log() { printf '\n[docker-e2e] %s\n' "$*"; }

if ! curl -fsS -m 3 "$CUTTLEFISH_API_URL/healthz" >/dev/null 2>&1; then
  log "cuttlefish control plane not reachable at $CUTTLEFISH_API_URL"
  log "start it first, e.g.:  (cd ~/projects/cuttlefish && make up)"
  exit 1
fi

cleanup() {
  if [ "$CUTTLEFISH_OTEL" = "1" ] && [ -f "$ROOT/scripts/e2e/cuttlefish-otel-down.sh" ]; then
    "$ROOT/scripts/e2e/cuttlefish-otel-down.sh" || true
  fi
  if [ "$KEEP" != "1" ]; then
    log "stopping harness stack (KEEP=1 to leave it running)"
    docker compose down -v >/dev/null 2>&1 || true
  else
    log "leaving harness stack running on :$OMEGA_PORT"
  fi
}
trap cleanup EXIT

log "building and starting harness (docker compose)"
docker compose up -d --build

log "waiting for harness health on :$OMEGA_PORT"
for _ in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:$OMEGA_PORT/v1/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS -m 3 "http://127.0.0.1:$OMEGA_PORT/v1/health" >/dev/null 2>&1 \
  || { docker compose logs --no-color --tail=50 harness; log "harness failed to become healthy"; exit 1; }

if [ "$CUTTLEFISH_OTEL" = "1" ]; then
  "$ROOT/scripts/e2e/cuttlefish-otel-up.sh"
fi

HARNESS_API_URL="http://127.0.0.1:$OMEGA_PORT" \
RUNTIME_BASE_URL="$RUNTIME_BASE_URL" \
EXPECT_TRACES="$CUTTLEFISH_OTEL" \
"$ROOT/scripts/e2e/cuttlefish-hello-world.sh"
