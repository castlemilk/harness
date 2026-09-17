#!/usr/bin/env bash
#
# Run the ledger-vs-single LCB eval for one or more passes.
#
#   scripts/run-ledger-eval.sh --model meta/muse-spark-1.3-contributor
#   scripts/run-ledger-eval.sh --model stealth/union-alpha --passes 3
#   scripts/run-ledger-eval.sh --model qwen3.8:27b-mlx-64k --kind ollama \
#     --base-url http://localhost:11434 --max-output 8192 --no-think
#
# Reports land in /tmp/ledger-eval-<tag>-pass<N>.json (tag defaults to a
# sanitized model id). API keys come from the environment or the repo .env.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODEL=""
KIND="generic"
BASE_URL=""
PROBLEMS="scripts/fixtures/lcb-hard-9.json"
N=9
PASSES=1
START_PASS=1
MAX_OUTPUT=131072
MAX_ITERS=10
TIMEOUT_MS=3600000
THINK=1
HIDDEN=1
FRESH=0
TAG=""
OUT_DIR="/tmp"

usage() {
  sed -n '2,12p' "$0"
  cat <<'EOF'

Options:
  --model <id>        provider model id (required)
  --kind <kind>       generic|ollama|openai|anthropic|kimi (default generic)
  --base-url <url>    provider base URL (default https://openrouter.ai/api/v1,
                      or http://localhost:11434 for --kind ollama)
  --problems <file>   problems JSON (default scripts/fixtures/lcb-hard-9.json)
  --n <count>         number of problems (default 9)
  --passes <count>    paired passes to run (default 1)
  --start-pass <n>    first pass number, for redoing a lost pass (default 1)
  --max-output <tok>  per-call output cap (default 131072)
  --max-iters <n>     ledger worker rounds (default 10)
  --timeout-ms <ms>   per-call timeout (default 3600000)
  --no-think          disable provider reasoning
  --public            grade public tests instead of hiddenTests
  --fresh             run a fresh-perspective worker first
  --tag <name>        report name tag (default: sanitized model id)
  --out-dir <dir>     report directory (default /tmp)
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --kind) KIND="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --problems) PROBLEMS="$2"; shift 2 ;;
    --n) N="$2"; shift 2 ;;
    --passes) PASSES="$2"; shift 2 ;;
    --start-pass) START_PASS="$2"; shift 2 ;;
    --max-output) MAX_OUTPUT="$2"; shift 2 ;;
    --max-iters) MAX_ITERS="$2"; shift 2 ;;
    --timeout-ms) TIMEOUT_MS="$2"; shift 2 ;;
    --no-think) THINK=0; shift ;;
    --public) HIDDEN=0; shift ;;
    --fresh) FRESH=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$MODEL" ] || usage

# Load repo .env for API keys (does not override already-set vars).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "$BASE_URL" ]; then
  if [ "$KIND" = "ollama" ]; then
    BASE_URL="http://localhost:11434"
  else
    BASE_URL="https://openrouter.ai/api/v1"
  fi
fi

if [ "$KIND" = "ollama" ]; then
  API_KEY=""
else
  API_KEY="${OPENROUTER_API_KEY:-${OPENAI_API_KEY:-}}"
fi

if [ -z "$TAG" ]; then
  TAG="$(printf '%s' "$MODEL" | tr '/:.' '-')"
fi

EXTRA=()
[ "$THINK" = "1" ] && EXTRA+=(--think)
[ "$HIDDEN" = "1" ] && EXTRA+=(--hidden)
[ "$FRESH" = "1" ] && EXTRA+=(--fresh)

END_PASS=$((START_PASS + PASSES - 1))
for ((i = START_PASS; i <= END_PASS; i++)); do
  OUT="$OUT_DIR/ledger-eval-${TAG}-pass${i}.json"
  echo "===== ${TAG} PASS ${i} ($(date -u +%H:%M:%S)) -> ${OUT} ====="
  node apps/cli/dist/index.js ledger eval \
    --problems "$PROBLEMS" \
    --kind "$KIND" --base-url "$BASE_URL" ${API_KEY:+--api-key "$API_KEY"} \
    --model "$MODEL" \
    --modes single,ledger --n "$N" \
    --max-output "$MAX_OUTPUT" --max-iters "$MAX_ITERS" --timeout-ms "$TIMEOUT_MS" \
    "${EXTRA[@]}" \
    --out "$OUT" \
    || echo "pass ${i} exited nonzero ($?)"
done
echo "===== ${TAG} passes ${START_PASS}-${END_PASS} done ($(date -u +%H:%M:%S)) ====="
