#!/usr/bin/env bash
#
# Restore the micropod cuttlefish controlplane without OTLP tracing.
#
#   scripts/e2e/cuttlefish-otel-down.sh
#
# Recreates the controlplane with the stack's own image and IP-pinned
# postgres/minio (micropod DNS does not resolve service names for new
# containers). Volumes and run history are untouched.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log() { printf '\n[cuttlefish-otel-down] %s\n' "$*"; }
die() { printf '\n[cuttlefish-otel-down] FAIL: %s\n' "$*" >&2; exit 1; }

CUTTLEFISH_DIR="${CUTTLEFISH_DIR:-}"
if [ -z "$CUTTLEFISH_DIR" ]; then
  for candidate in "$(cd "$HARNESS_ROOT/.." && pwd)/cuttlefish" "$HOME/projects/cuttlefish"; do
    if [ -f "$candidate/Makefile" ]; then CUTTLEFISH_DIR="$candidate"; break; fi
  done
fi
[ -n "$CUTTLEFISH_DIR" ] || die "cuttlefish repo not found (set CUTTLEFISH_DIR)"

MICROPOD_DOCKER="${CUTTLEFISH_DOCKER_HOST:-unix://$HOME/.micropod/docker.sock}"
CONTROLPLANE_HOST_PORT="${CONTROLPLANE_HOST_PORT:-4444}"
COMPOSE_PROJECT="${CUTTLEFISH_COMPOSE_PROJECT:-cuttlefish_micropodval}"

MP() { DOCKER_HOST="$MICROPOD_DOCKER" docker "$@"; }

MP_CP="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*controlplane' | head -1 || true)"
MP_PG="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*postgres' | head -1 || true)"
MP_MINIO="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*minio' | head -1 || true)"
[ -n "$MP_PG" ] && [ -n "$MP_MINIO" ] || die "micropod postgres/minio not found; cannot restore the controlplane"

PG_IP="$(MP inspect --type container "$MP_PG" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
MINIO_IP="$(MP inspect --type container "$MP_MINIO" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"

# Idempotency: already restored (no OTLP endpoint, deps pinned)?
if [ -n "$MP_CP" ]; then
  RUNNING_ENV="$(MP inspect --type container "$MP_CP" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
  RUNNING_OTEL="$(printf '%s\n' "$RUNNING_ENV" | grep -E '^OTEL_EXPORTER_OTLP_ENDPOINT=' | grep -v '=$' || true)"
  RUNNING_DEPS="$(printf '%s\n' "$RUNNING_ENV" | grep -x "DATABASE_URL=postgres://cuttlefish:cuttlefish@${PG_IP}:5432/cuttlefish?sslmode=disable" || true)"
  if [ -z "$RUNNING_OTEL" ] && [ -n "$RUNNING_DEPS" ]; then
    log "controlplane already restored (tracing off); nothing to do"
    exit 0
  fi
fi

OVERRIDE="$(mktemp -t cuttlefish-restore).yaml"
cat > "$OVERRIDE" <<EOF
services:
  controlplane:
    environment:
      DATABASE_URL: postgres://cuttlefish:cuttlefish@${PG_IP}:5432/cuttlefish?sslmode=disable
      MINIO_ENDPOINT: http://${MINIO_IP}:9000
EOF

cd "$CUTTLEFISH_DIR"
HOST="${CUTTLE_HOST:-localhost}"
export HOST
export DEV_FORCE_LOCAL_DEFAULTS=1
# shellcheck disable=SC2016
eval "$(sed -n '/^if \[\[ "\$DEV_FORCE_LOCAL_DEFAULTS" == "1" \]\]/,/^fi$/p' scripts/dev/start_stack.sh)"

[ -n "$MP_CP" ] && MP rm -f "$MP_CP" >/dev/null 2>&1 || true
log "restoring $MP_CP without tracing"
DOCKER_HOST="$MICROPOD_DOCKER" CONTROLPLANE_HOST_PORT="$CONTROLPLANE_HOST_PORT" \
  docker compose --project-name "$COMPOSE_PROJECT" \
  -f docker-compose.yml -f "$OVERRIDE" \
  up -d --no-deps --no-build controlplane 2>&1 | tail -1

log "waiting for controlplane /readyz"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://127.0.0.1:${CONTROLPLANE_HOST_PORT}/readyz" >/dev/null 2>&1; then
    log "controlplane restored (tracing off)"
    exit 0
  fi
  sleep 2
done
log "warning: restored controlplane did not become ready in time"
