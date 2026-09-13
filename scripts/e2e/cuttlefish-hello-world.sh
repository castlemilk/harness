#!/usr/bin/env bash
#
# End-to-end check: harness task -> cuttlefish hello-world workflow.
#
# Prerequisites:
#   - cuttlefish local stack reachable (CUTTLEFISH_API_URL, default localhost:4444)
#   - harness API reachable (HARNESS_API_URL, default localhost:4000)
#
# What it does:
#   1. registers (or reuses) a RuntimeConnection on the harness
#   2. publishes deploy/cuttlefish/hello-world.yaml through the harness API
#   3. creates a task tagged flow:hello-world and runs it
#   4. waits for the task, then asserts the cuttlefish run succeeded and its
#      logs contain the hello-world marker
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

HARNESS_API_URL="${HARNESS_API_URL:-http://127.0.0.1:4000}"
CUTTLEFISH_API_URL="${CUTTLEFISH_API_URL:-http://127.0.0.1:4444}"
# URL stored on the RuntimeConnection; must be reachable from the harness
# process. Native harness: http://localhost:4444. Docker harness:
# http://host.docker.internal:4444.
RUNTIME_BASE_URL="${RUNTIME_BASE_URL:-$CUTTLEFISH_API_URL}"
RUNTIME_NAME="${RUNTIME_NAME:-local-docker}"
PROJECT_PATH="${PROJECT_PATH:-/tmp/omega-hello-world}"
TASK_TITLE="${TASK_TITLE:-Hello world workflow}"
WORKFLOW_FILE="${WORKFLOW_FILE:-$ROOT/deploy/cuttlefish/hello-world.yaml}"
TIMEOUT_S="${TIMEOUT_S:-180}"
# When 1, also assert the distributed trace (Tempo) and hotspots (Mimir).
EXPECT_TRACES="${EXPECT_TRACES:-0}"

log() { printf '\n[hello-world] %s\n' "$*"; }
die() { printf '\n[hello-world] FAIL: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"

py() { python3 -c "$1"; }

wait_http() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
      log "$name is up ($url)"
      return 0
    fi
    sleep 2
  done
  die "$name not reachable at $url"
}

json_field() {
  # json_field <json> <python-expression over d>
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($2)" "$1"
}

wait_http "$CUTTLEFISH_API_URL/healthz" "cuttlefish control plane"
wait_http "$HARNESS_API_URL/v1/health" "harness API"

# ── 1. Runtime connection ────────────────────────────────────────────────────
log "ensuring runtime connection '$RUNTIME_NAME' -> $RUNTIME_BASE_URL"
RUNTIMES_JSON="$(curl -fsS "$HARNESS_API_URL/v1/runtimes")"
RUNTIME_ID="$(python3 -c '
import json,sys
name=sys.argv[2]
for r in json.loads(sys.argv[1]).get("runtimes", []):
    if r["name"]==name:
        print(r["id"]); break
' "$RUNTIMES_JSON" "$RUNTIME_NAME")"
if [ -z "$RUNTIME_ID" ]; then
  RUNTIME_ID="$(curl -fsS -X POST "$HARNESS_API_URL/v1/runtimes" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$RUNTIME_NAME\",\"baseUrl\":\"$RUNTIME_BASE_URL\"}" \
    | py 'import json,sys; print(json.load(sys.stdin)["id"])')"
  log "created runtime connection $RUNTIME_ID"
else
  log "reusing runtime connection $RUNTIME_ID"
fi

# ── 2. Publish hello-world workflow ──────────────────────────────────────────
[ -f "$WORKFLOW_FILE" ] || die "workflow file not found: $WORKFLOW_FILE"
log "publishing workflow from $WORKFLOW_FILE"
PUBLISH_PAYLOAD="$(python3 - "$WORKFLOW_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    yaml_text = fh.read()
print(json.dumps({
    "name": "hello-world",
    "description": "Minimal hello-world workflow for the harness -> cuttlefish e2e check.",
    "workflowYAML": yaml_text,
    "updateExisting": True,
    "publish": True,
}))
PY
)"
PUBLISH_RESPONSE="$(curl -fsS -X POST "$HARNESS_API_URL/v1/runtimes/$RUNTIME_ID/workflows" \
  -H 'Content-Type: application/json' -d "$PUBLISH_PAYLOAD")"
WORKFLOW_VERSION_ID="$(json_field "$PUBLISH_RESPONSE" 'd["workflowVersion"]["id"]')"
log "published hello-world version $WORKFLOW_VERSION_ID"

# ── 3. Project + task ────────────────────────────────────────────────────────
PROJECTS_JSON="$(curl -fsS "$HARNESS_API_URL/v1/projects")"
PROJECT_ID="$(python3 -c '
import json,sys
path=sys.argv[2]
for p in json.loads(sys.argv[1]):
    if p["path"]==path:
        print(p["id"]); break
' "$PROJECTS_JSON" "$PROJECT_PATH")"
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(curl -fsS -X POST "$HARNESS_API_URL/v1/projects" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"hello-world\",\"path\":\"$PROJECT_PATH\"}" \
    | py 'import json,sys; print(json.load(sys.stdin)["id"])')"
  log "created project $PROJECT_ID"
else
  log "reusing project $PROJECT_ID"
fi

TASK_ID="$(curl -fsS -X POST "$HARNESS_API_URL/v1/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PROJECT_ID\",\"title\":\"$TASK_TITLE\",\"tags\":[\"flow:hello-world\"]}" \
  | py 'import json,sys; print(json.load(sys.stdin)["id"])')"
log "created task $TASK_ID (tag flow:hello-world)"

curl -fsS -X POST "$HARNESS_API_URL/v1/tasks/$TASK_ID/run" \
  -H 'Content-Type: application/json' -d '{}' >/dev/null
log "dispatched task; polling for completion (timeout ${TIMEOUT_S}s)"

# ── 4. Wait for the task ─────────────────────────────────────────────────────
DEADLINE=$(( $(date +%s) + TIMEOUT_S ))
STATUS=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS="$(curl -fsS "$HARNESS_API_URL/v1/tasks/$TASK_ID" | py 'import json,sys; print(json.load(sys.stdin)["status"])')"
  case "$STATUS" in
    done|failed) break ;;
  esac
  sleep 2
done

FLOWS_JSON="$(curl -fsS "$HARNESS_API_URL/v1/flows?taskId=$TASK_ID")"
FLOW_ID="$(json_field "$FLOWS_JSON" 'd["flows"][0]["id"] if d.get("flows") else ""')"
FLOW_STATUS="$(json_field "$FLOWS_JSON" 'd["flows"][0]["status"] if d.get("flows") else ""')"
EXTERNAL_RUN_ID="$(json_field "$FLOWS_JSON" 'd["flows"][0]["externalRunId"] if d.get("flows") else ""')"

if [ "$STATUS" != "done" ]; then
  log "task status: $STATUS"
  curl -fsS "$HARNESS_API_URL/v1/tasks/$TASK_ID" | python3 -m json.tool || true
  if [ -n "$FLOW_ID" ]; then
    log "flow $FLOW_ID ($FLOW_STATUS) logs:"
    curl -fsS "$HARNESS_API_URL/v1/flows/$FLOW_ID/logs" || true
  fi
  die "task did not complete successfully (status=$STATUS flow=$FLOW_STATUS)"
fi

[ "$FLOW_STATUS" = "SUCCEEDED" ] || die "flow status is $FLOW_STATUS (expected SUCCEEDED)"
[ -n "$EXTERNAL_RUN_ID" ] || die "no cuttlefish run id tracked on the flow"

LOGS_JSON="$(curl -fsS "$HARNESS_API_URL/v1/flows/$FLOW_ID/logs")"
LOGS="$(json_field "$LOGS_JSON" 'd["logs"]')"
case "$LOGS" in
  *"hello from cuttlefish"*) ;;
  *) echo "$LOGS"; die "run logs do not contain the hello-world marker" ;;
esac

# ── 5. MCP endpoint ──────────────────────────────────────────────────────────
MCP_RESPONSE="$(curl -fsS -X POST "$HARNESS_API_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"
TOOL_COUNT="$(json_field "$MCP_RESPONSE" 'len(d["result"]["tools"])')"
[ "$TOOL_COUNT" -gt 0 ] || die "MCP endpoint returned no tools"
log "MCP endpoint exposes $TOOL_COUNT tools"

# ── 6. Distributed trace (Tempo) + hotspots (Mimir) ─────────────────────────
TRACE_ID=""
if [ "$EXPECT_TRACES" = "1" ]; then
  log "waiting for the distributed trace in Tempo (flow $FLOW_ID)"
  SPAN_COUNT=0
  for _ in $(seq 1 30); do
    FLOW_DETAIL="$(curl -fsS "$HARNESS_API_URL/v1/flows/$FLOW_ID")"
    TRACE_ID="$(json_field "$FLOW_DETAIL" 'd["flow"].get("traceId") or ""' 2>/dev/null || echo "")"
    if [ -n "$TRACE_ID" ]; then
      TRACE_RESPONSE="$(curl -fsS "$HARNESS_API_URL/v1/flows/$FLOW_ID/trace" 2>/dev/null || echo '{}')"
      SPAN_COUNT="$(json_field "$TRACE_RESPONSE" '(d.get("trace") or {}).get("spanCount", 0)' 2>/dev/null || echo 0)"
      if [ "${SPAN_COUNT:-0}" -gt 0 ] 2>/dev/null; then break; fi
    fi
    sleep 2
  done

  [ -n "$TRACE_ID" ] || die "flow has no traceId (is OTEL_EXPORTER_OTLP_ENDPOINT set on the harness?)"
  [ "${SPAN_COUNT:-0}" -gt 0 ] 2>/dev/null || die "no spans found in Tempo for trace $TRACE_ID"

  # Cuttlefish exports with its own batch cadence; wait for its spans to land.
  log "waiting for cuttlefish-controlplane spans to join trace $TRACE_ID"
  SERVICES=""
  for _ in $(seq 1 15); do
    TRACE_RESPONSE="$(curl -fsS "$HARNESS_API_URL/v1/flows/$FLOW_ID/trace" 2>/dev/null || echo '{}')"
    SERVICES="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(",".join((d.get("trace") or {}).get("services", [])))' "$TRACE_RESPONSE" 2>/dev/null || echo "")"
    case "$SERVICES" in
      *cuttlefish-controlplane*) break ;;
    esac
    sleep 2
  done

  SPAN_COUNT="$(json_field "$TRACE_RESPONSE" '(d.get("trace") or {}).get("spanCount", 0)' 2>/dev/null || echo 0)"
  log "trace $TRACE_ID has $SPAN_COUNT spans across: $SERVICES"
  case "$SERVICES" in
    *omega-harness*) ;;
    *) die "trace is missing harness spans (services: $SERVICES)" ;;
  esac
  case "$SERVICES" in
    *cuttlefish-controlplane*) ;;
    *) die "trace is missing cuttlefish-controlplane spans (services: $SERVICES); is cuttlefish exporting OTLP?" ;;
  esac

  log "waiting for spanmetrics to reach Mimir"
  HOTSPOTS_AVAILABLE=false
  for _ in $(seq 1 30); do
    HOTSPOTS_RESPONSE="$(curl -fsS "$HARNESS_API_URL/v1/observability/hotspots?window=15m&limit=5" 2>/dev/null || echo '{}')"
    HOTSPOTS_AVAILABLE="$(json_field "$HOTSPOTS_RESPONSE" 'd.get("available", False)' 2>/dev/null || echo False)"
    if [ "$HOTSPOTS_AVAILABLE" = "True" ]; then break; fi
    sleep 3
  done

  if [ "$HOTSPOTS_AVAILABLE" = "True" ]; then
    log "hotspots (p95):"
    printf '%s' "$HOTSPOTS_RESPONSE" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for e in d.get("entries", []):
    print("  %8.1fms %6.2f/s  %s  %s" % (e.get("p95Ms", 0), e.get("callsPerSec", 0), e.get("service", ""), e.get("operation", "")))
'
  else
    REASON="$(json_field "$HOTSPOTS_RESPONSE" 'd.get("reason","unknown")' 2>/dev/null || echo unknown)"
    log "warning: hotspots unavailable ($REASON) — spanmetrics may need another flush cycle"
  fi
fi

log "PASS"
printf '[hello-world] task=%s flow=%s cuttlefish_run=%s' "$TASK_ID" "$FLOW_ID" "$EXTERNAL_RUN_ID"
[ -n "$TRACE_ID" ] && printf ' trace=%s' "$TRACE_ID"
printf '\n[hello-world] logs:\n%s\n' "$LOGS"
