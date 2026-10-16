#!/usr/bin/env bash
# Runs the harder-v2 suite through the external opencode CLI for each injection arm.
#
#   baseline — no injected context
#   skills   — curated engineering procedure prepended to the task description
#   kg       — prior-art graph derived from the repair corpus
#
# Usage:
#   ITER=1 ARMS=baseline,skills,kg ./run-arms.sh
#
# Env:
#   ITER    iterations per arm (default 1)
#   ARMS    comma list of arms (default baseline,skills,kg)
#   MODEL   model id (default opencode/deepseek-v4.1-flash-free)
#   SUITE   suite name (default harder-v2)
#   TIMEOUT per-task timeout in ms (default 300000)
#
# Requires the harness API on :4000 (see `task dev:server`) and a first-party
# opencode login. Every call is free-tier, but it does consume plan quota.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CLI="$REPO/apps/cli/dist/index.js"

ITER="${ITER:-1}"
ARMS="${ARMS:-baseline,skills,kg}"
MODEL="${MODEL:-opencode/deepseek-v4.1-flash-free}"
SUITE="${SUITE:-harder-v2}"
TIMEOUT="${TIMEOUT:-300000}"

if [ ! -f "$CLI" ]; then
  echo "CLI not built at $CLI — run: pnpm --filter @omega/cli build" >&2
  exit 1
fi

if ! curl -sf -m 5 http://localhost:4000/v1/health > /dev/null; then
  echo "Harness API is not answering on :4000 — start it with 'task dev:server'." >&2
  exit 1
fi

mkdir -p "$HERE/results"
IFS=',' read -r -a ARM_LIST <<< "$ARMS"

for arm in "${ARM_LIST[@]}"; do
  case "$arm" in
    baseline) CONTEXT=() ;;
    skills)   CONTEXT=(--context-dir "$HERE/skills") ;;
    kg)       CONTEXT=(--context-dir "$HERE/kg") ;;
    *) echo "Unknown arm: $arm" >&2; exit 1 ;;
  esac

  for i in $(seq 1 "$ITER"); do
    LOG="$HERE/results/${arm}-run${i}.log"
    echo "=== arm=$arm iteration=$i/$ITER model=$MODEL suite=$SUITE"
    # Project prefix keeps each arm's harness projects distinguishable in the DB.
    node "$CLI" bench eval \
      --suite "$SUITE" \
      --harnesses opencode \
      --harness-model "$MODEL" \
      --project-prefix "inject-$arm" \
      --timeout "$TIMEOUT" \
      "${CONTEXT[@]}" 2>&1 | tee "$LOG"
    echo "=== arm=$arm iteration=$i done (log: $LOG)"
  done
done

echo
echo "Sweep complete. Analyse with: node $(basename "$HERE")/analyze.mjs"
