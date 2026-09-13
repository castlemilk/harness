#!/usr/bin/env bash
#
# Enable distributed tracing on the micropod cuttlefish controlplane.
#
#   scripts/e2e/cuttlefish-otel-up.sh
#
# What it does:
#   1. builds the controlplane image from the local repo with the W3C
#      propagator patch and loads it into micropod (Apple Container OCI load)
#   2. recreates the micropod controlplane with OTEL_EXPORTER_OTLP_ENDPOINT
#      pointing at the harness collector via the Mac's LAN IP
#   3. waits for /readyz; runners re-register automatically
#
# Why the LAN IP: containers on a micropod custom network cannot reach the
# vmnet gateway (192.168.64.1) or host.docker.internal, but they can reach the
# Mac's LAN address through VM NAT. Why IP-pinned deps: micropod's embedded DNS
# no longer resolves service names for new containers, so postgres/minio are
# addressed by their container IPs. See docs/observability.md.
#
# Environment:
#   CUTTLEFISH_DIR            cuttlefish checkout (default ../cuttlefish)
#   CUTTLEFISH_OTEL_HOST_IP   Mac LAN IP (default: en0/en1 address)
#   CUTTLEFISH_OTEL_HTTP_PORT collector host port (default 14318)
#   CUTTLEFISH_OTEL_IMAGE     image tag (default cuttlefish-controlplane:otel)
#   CUTTLEFISH_OTEL_BUILD     1 forces an image rebuild
#   CUTTLEFISH_OTEL_SOFT      1 only warns when the collector is unreachable
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log() { printf '\n[cuttlefish-otel] %s\n' "$*"; }
die() { printf '\n[cuttlefish-otel] FAIL: %s\n' "$*" >&2; exit 1; }

CUTTLEFISH_DIR="${CUTTLEFISH_DIR:-}"
if [ -z "$CUTTLEFISH_DIR" ]; then
  for candidate in "$(cd "$HARNESS_ROOT/.." && pwd)/cuttlefish" "$HOME/projects/cuttlefish"; do
    if [ -f "$candidate/Makefile" ]; then
      CUTTLEFISH_DIR="$candidate"
      break
    fi
  done
fi
[ -n "$CUTTLEFISH_DIR" ] && [ -f "$CUTTLEFISH_DIR/Makefile" ] || die "cuttlefish repo not found (set CUTTLEFISH_DIR)"

# A wedged Micropod runtime makes every container op hang; refuse to pile more
# operations onto it. See docs/micropod-recovery.md.
if [ "${MICROPOD_HEALTH_SKIP:-0}" != "1" ]; then
  if ! node "$HARNESS_ROOT/scripts/ops/micropod-health.mjs" --quiet; then
    node "$HARNESS_ROOT/scripts/ops/micropod-health.mjs" --json || true
    die "micropod runtime is unhealthy; refusing to mutate it (set MICROPOD_HEALTH_SKIP=1 to override)"
  fi
fi

MICROPOD_DOCKER="${CUTTLEFISH_DOCKER_HOST:-unix://$HOME/.micropod/docker.sock}"
OTEL_HTTP_PORT="${CUTTLEFISH_OTEL_HTTP_PORT:-14318}"
IMAGE="${CUTTLEFISH_OTEL_IMAGE:-cuttlefish-controlplane:otel}"
CONTROLPLANE_HOST_PORT="${CONTROLPLANE_HOST_PORT:-4444}"

MP() { DOCKER_HOST="$MICROPOD_DOCKER" docker "$@"; }

# ── Find the micropod cuttlefish stack ──────────────────────────────────────
MP_CP="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*controlplane' | head -1 || true)"
MP_PG="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*postgres' | head -1 || true)"
MP_MINIO="$(MP ps -a --format '{{.Names}}' | grep -E '^cuttlefish.*minio' | head -1 || true)"
[ -n "$MP_CP" ] && [ -n "$MP_PG" ] && [ -n "$MP_MINIO" ] || die "micropod cuttlefish stack not found; run \`make up\` there first"

PG_IP="$(MP inspect --type container "$MP_PG" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
MINIO_IP="$(MP inspect --type container "$MP_MINIO" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
NETWORK="$(MP inspect --type container "$MP_CP" --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | head -1)"
[ -n "$PG_IP" ] && [ -n "$MINIO_IP" ] && [ -n "$NETWORK" ] || die "could not read the micropod stack's network/IPs"

HOST_IP="${CUTTLEFISH_OTEL_HOST_IP:-}"
if [ -z "$HOST_IP" ]; then
  HOST_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi
[ -n "$HOST_IP" ] || die "could not determine the Mac's LAN IP (set CUTTLEFISH_OTEL_HOST_IP)"
OTEL_ENDPOINT="${CUTTLEFISH_OTEL_ENDPOINT:-http://${HOST_IP}:${OTEL_HTTP_PORT}}"

log "controlplane:  $MP_CP ($NETWORK)"
log "deps:          postgres=$PG_IP minio=$MINIO_IP"
log "OTLP endpoint: $OTEL_ENDPOINT"

# ── Idempotency: already tracing with the wanted image + pinned deps? ───────
DESIRED_IMAGE_ID="$(MP image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
RUNNING_ENV="$(MP inspect --type container "$MP_CP" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
RUNNING_IMAGE_ID="$(MP inspect --type container "$MP_CP" --format '{{.Image}}' 2>/dev/null || true)"
RUNNING_OTEL="$(printf '%s\n' "$RUNNING_ENV" | grep -x "OTEL_EXPORTER_OTLP_ENDPOINT=$OTEL_ENDPOINT" || true)"
RUNNING_DEPS="$(printf '%s\n' "$RUNNING_ENV" | grep -x "DATABASE_URL=postgres://cuttlefish:cuttlefish@${PG_IP}:5432/cuttlefish?sslmode=disable" || true)"
if [ -n "$RUNNING_OTEL" ] && [ -n "$RUNNING_DEPS" ] && [ "$RUNNING_IMAGE_ID" = "$DESIRED_IMAGE_ID" ]; then
  log "controlplane already exports to $OTEL_ENDPOINT with image $IMAGE; nothing to do"
  exit 0
fi

# ── Verify the collector is reachable from the micropod network ─────────────
log "probing collector at $OTEL_ENDPOINT from $NETWORK"
COLLECTOR_OK=0
for _ in $(seq 1 6); do
  if MP run --rm --network "$NETWORK" alpine:3.19 sh -c \
    "wget -qO- -T 5 --header='Content-Type: application/json' --post-data='{\"resourceSpans\":[]}' $OTEL_ENDPOINT/v1/traces 2>/dev/null | grep -q partialSuccess" >/dev/null 2>&1; then
    COLLECTOR_OK=1
    break
  fi
  sleep 3
done
if [ "$COLLECTOR_OK" != "1" ]; then
  if [ "${CUTTLEFISH_OTEL_SOFT:-0}" = "1" ]; then
    log "warning: collector not reachable at $OTEL_ENDPOINT from $NETWORK"
  else
    die "collector not reachable at $OTEL_ENDPOINT from $NETWORK (is the harness stack up? set CUTTLEFISH_OTEL_SOFT=1 to continue)"
  fi
else
  log "collector reachable from the micropod network"
fi

# ── Build + load the patched controlplane image ─────────────────────────────
if ! grep -q "SetTextMapPropagator" "$CUTTLEFISH_DIR/cmd/controlplane/main.go" 2>/dev/null; then
  die "cuttlefish lacks the W3C propagator patch (cmd/controlplane/main.go: SetTextMapPropagator)"
fi

if ! MP image inspect "$IMAGE" >/dev/null 2>&1 || [ "${CUTTLEFISH_OTEL_BUILD:-0}" = "1" ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64|aarch64) PLATFORM="linux/arm64" ;;
    x86_64) PLATFORM="linux/amd64" ;;
    *) die "unsupported host arch: $ARCH" ;;
  esac
  TAR="$(mktemp -t cuttlefish-controlplane).tar"
  log "building $IMAGE ($PLATFORM) from $CUTTLEFISH_DIR"
  docker buildx build --platform "$PLATFORM" --no-cache-filter build \
    -f "$CUTTLEFISH_DIR/deploy/Dockerfile.controlplane" \
    --tag "$IMAGE" --output "type=oci,dest=$TAR" "$CUTTLEFISH_DIR" >/dev/null
  if command -v container >/dev/null 2>&1; then
    log "loading image into micropod (Apple Container)"
    container image load -i "$TAR" >/dev/null
  else
    docker load -i "$TAR" >/dev/null
  fi
  rm -f "$TAR"
else
  log "using existing micropod image $IMAGE"
fi

# ── Recreate the controlplane with tracing ──────────────────────────────────
OVERRIDE="$(mktemp -t cuttlefish-otel).yaml"
cat > "$OVERRIDE" <<EOF
services:
  controlplane:
    image: ${IMAGE}
    environment:
      DATABASE_URL: postgres://cuttlefish:cuttlefish@${PG_IP}:5432/cuttlefish?sslmode=disable
      MINIO_ENDPOINT: http://${MINIO_IP}:9000
      OTEL_SERVICE_NAME: cuttlefish-controlplane
      OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_ENDPOINT}
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
EOF

cd "$CUTTLEFISH_DIR"
HOST="${CUTTLE_HOST:-localhost}"
export HOST
export DEV_FORCE_LOCAL_DEFAULTS=1
# shellcheck disable=SC2016
eval "$(sed -n '/^if \[\[ "\$DEV_FORCE_LOCAL_DEFAULTS" == "1" \]\]/,/^fi$/p' scripts/dev/start_stack.sh)"

MP rm -f "$MP_CP" >/dev/null 2>&1 || true
log "recreating $MP_CP with tracing"
DOCKER_HOST="$MICROPOD_DOCKER" CONTROLPLANE_HOST_PORT="$CONTROLPLANE_HOST_PORT" \
  docker compose --project-name "${CUTTLEFISH_COMPOSE_PROJECT:-cuttlefish_micropodval}" \
  -f docker-compose.yml -f "$OVERRIDE" \
  up -d --no-deps --no-build controlplane 2>&1 | tail -1

log "waiting for controlplane /readyz"
for _ in $(seq 1 45); do
  if curl -fsS -m 2 "http://127.0.0.1:${CONTROLPLANE_HOST_PORT}/readyz" >/dev/null 2>&1; then
    log "controlplane ready with tracing -> $OTEL_ENDPOINT"
    log "runners re-register automatically against host port ${CONTROLPLANE_HOST_PORT}"
    exit 0
  fi
  sleep 2
done

MP logs --no-color --tail=30 "$MP_CP" 2>/dev/null || true
die "controlplane did not become ready with tracing"
