#!/usr/bin/env bash
# Runs the harder-v2 suite through the external opencode CLI, one task per
# invocation, for each context-injection arm:
#
#   baseline — no injected context
#   skills   — curated engineering procedure prepended to the task description
#   kg       — prior-art graph derived from the repair corpus
#
# One task per invocation, with the CLI's provider circuit cleared first:
#
#   * The harness opens a provider circuit on >50% errors in a 30-minute window
#     (at least 5 calls) and then *skips* runs before the CLI starts, which turns
#     the rest of an arm into instant failures. Cleared before each task, real
#     aborts cannot accumulate into a skip.
#   * A run that is skipped anyway is retried rather than counted, and every
#     attempt is written to the manifest, so the analysis can tell an
#     infrastructure failure from a model failure.
#
# Usage:
#   ITER=1 ARMS=baseline,skills,kg ./run-arms.sh
#
# Env:
#   ITER          last iteration per arm (default 1)
#   START_ITER    first iteration per arm (default 1); use it to add iterations
#                 to an existing sweep without repeating the earlier ones
#   RESUME=1      skip (arm, iteration, task) triples the manifest already
#                 records, so an interrupted sweep can be continued
#   ARMS          comma list of arms (default baseline,skills,kg)
#   MODEL         model id (default opencode/deepseek-v4.1-flash-free)
#   SUITE         suite name (default harder-v2)
#   TIMEOUT       per-task timeout in ms (default 600000)
#   API           harness API base (default http://localhost:4000)
#   PROVIDER_KEY  router health key to clear (default external:opencode)
#   TASKS         space-separated task ids (default: every id in the suite file)
#
# Outputs, under results/: manifest.jsonl (one line per run) and logs/.
#
# Requires the harness API on :4000 and a first-party opencode login. Every call
# is free-tier, but it does consume plan quota.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CLI="$REPO/apps/cli/dist/index.js"

ITER="${ITER:-1}"
START_ITER="${START_ITER:-1}"
ARMS="${ARMS:-baseline,skills,kg}"
MODEL="${MODEL:-opencode/deepseek-v4.1-flash-free}"
SUITE="${SUITE:-harder-v2}"
TIMEOUT="${TIMEOUT:-600000}"
API="${API:-http://localhost:4000}"
PROVIDER_KEY="${PROVIDER_KEY:-external:opencode}"

if [ ! -f "$CLI" ]; then
  echo "CLI not built at $CLI — run: pnpm --filter @omega/cli build" >&2
  exit 1
fi

if ! curl -sf -m 5 "$API/v1/health" > /dev/null; then
  echo "Harness API is not answering on $API — start it with 'task dev:server'." >&2
  exit 1
fi

# Task ids come from the suite definition itself, so the sweep cannot drift from
# the suite. Order is the declaration order, duplicates dropped.
if [ -z "${TASKS:-}" ]; then
  SUITE_FILE="$REPO/packages/bench/src/suites/$SUITE.ts"
  if [ ! -f "$SUITE_FILE" ]; then
    echo "No suite definition at $SUITE_FILE" >&2
    exit 1
  fi
  TASKS="$(grep -oE "'${SUITE}-[a-z0-9-]+'" "$SUITE_FILE" | tr -d "'" | awk '!seen[$0]++')"
fi
if [ -z "${TASKS:-}" ]; then
  echo "No task ids resolved for suite $SUITE" >&2
  exit 1
fi

RESULTS="$HERE/results"
mkdir -p "$RESULTS/logs"
MANIFEST="$RESULTS/manifest.jsonl"

# RESUME=1 continues an interrupted sweep: every (arm, iteration, task) the
# manifest already records is skipped, so a run that lost its driver to a
# restart does not have to repeat the runs it did finish. The manifest is the
# authority — the same file analyze.mjs reads.
DONE_KEYS=""
if [ "${RESUME:-0}" = "1" ] && [ -f "$MANIFEST" ]; then
  DONE_KEYS="$(node -e '
    const fs = require("node:fs");
    const seen = new Set();
    for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        seen.add(`${r.arm}|${r.iter}|${r.task}`);
      } catch {}
    }
    process.stdout.write([...seen].join("\n"));
  ' "$MANIFEST")"
fi

# Clear the router's health record for the CLI. `circuitState: closed` in the
# response is the contract — anything else means the next run would be skipped.
reset_circuit() {
  local body
  body="$(curl -s -m 15 -X POST "$API/foreman/providers/$PROVIDER_KEY/health/reset" || true)"
  case "$body" in
    *'"circuitState":"closed"'*) return 0 ;;
    *) echo "  ! circuit reset unanswered: ${body:-<no response>}" >&2; return 1 ;;
  esac
}

IFS=',' read -r -a ARM_LIST <<< "$ARMS"

for arm in "${ARM_LIST[@]}"; do
  case "$arm" in
    baseline) CONTEXT=(); LABEL=() ;;
    skills)   CONTEXT=(--context-dir "$HERE/skills"); LABEL=(--harness-label "$MODEL+skills") ;;
    kg)       CONTEXT=(--context-dir "$HERE/kg"); LABEL=(--harness-label "$MODEL+kg") ;;
    *) echo "Unknown arm: $arm" >&2; exit 1 ;;
  esac

  for i in $(seq "$START_ITER" "$ITER"); do
    for task in $TASKS; do
      short="${task#${SUITE}-}"
      if [ -n "$DONE_KEYS" ] && printf '%s\n' "$DONE_KEYS" | grep -qxF "$arm|$i|$task"; then
        echo "  $arm i$i $short: already recorded — skipped (RESUME=1)"
        continue
      fi
      for attempt in 1 2 3; do
        LOG="$RESULTS/logs/${arm}-i${i}-${short}-a${attempt}.log"
        reset_circuit || true
        node "$CLI" bench eval \
          --suite "$SUITE" \
          --harnesses opencode \
          --harness-model "$MODEL" \
          --project-prefix "inject-$arm" \
          --task-id "$task" \
          --timeout "$TIMEOUT" \
          "${LABEL[@]}" \
          "${CONTEXT[@]}" > "$LOG" 2>&1 || true

        REPORT="$(sed -n 's/^Harness eval report written to //p' "$LOG" | tail -1)"
        if [ -n "$REPORT" ] && grep -q 'circuit is open' "$REPORT" && [ "$attempt" -lt 3 ]; then
          echo "  ! $arm i$i $short: skipped by an open circuit, retrying (attempt $((attempt + 1)))"
          sleep 3
          continue
        fi

        printf '{"arm":"%s","iter":%s,"task":"%s","attempt":%s,"report":"%s"}\n' \
          "$arm" "$i" "$task" "$attempt" "${REPORT:-}" >> "$MANIFEST"
        SUMMARY="$(grep -oE 'external:opencode: [0-9]+/[0-9]+ passed \([0-9.]+s\)' "$LOG" | tail -1)"
        echo "  $arm i$i $short: ${SUMMARY:-no summary — see $LOG}"
        break
      done
    done
  done
done

echo
echo "Sweep complete ($(grep -c . "$MANIFEST" || true) runs recorded). Analyse with: node $HERE/analyze.mjs"
