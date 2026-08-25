#!/usr/bin/env bash
# Build the Docker verifier images the DeepSWE adapter expects
# (omega-deepswe-<task>). Without these the adapter falls back to the local
# verifier, which applies host-specific repairs the container does not need —
# and quietly loses the ones only the container path applies (the narwhals
# pyarrow pin is applied inside the container by the adapter, but the image
# itself must exist first).
#
#   scripts/build-deepswe-images.sh                 # the 8-task scoring set
#   scripts/build-deepswe-images.sh <task-id>...    # specific tasks
#   scripts/build-deepswe-images.sh --all           # every task with a Dockerfile (~117, hours)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_DIR="$ROOT/deep-swe/tasks"

if [ ! -d "$TASKS_DIR" ]; then
  echo "error: $TASKS_DIR not found. Run: git submodule update --init deep-swe" >&2
  exit 1
fi

SCORING_SET=(
  abs-stepped-slices
  anko-default-function-arguments
  sqlfmt-create-table-ddl-formatting
  returns-validated-error-accumulation
  sqlite-utils-safe-import-checkpoints
  vulture-persistent-analysis-cache
  narwhals-rolling-window-suite
  psd-tools-blend-range-api
)

tag_for() {
  # Must match the adapter: packages/bench/src/adapters/deepswe.ts
  #   omega-deepswe-${taskName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g')"
  printf 'omega-deepswe-%s' "$normalized"
}

if [ "${1:-}" = "--all" ]; then
  TASKS=()
  for d in "$TASKS_DIR"/*/; do
    [ -f "$d/environment/Dockerfile" ] && TASKS+=("$(basename "$d")")
  done
else
  if [ $# -gt 0 ]; then
    TASKS=("$@")
  else
    TASKS=("${SCORING_SET[@]}")
  fi
fi

echo "Building ${#TASKS[@]} DeepSWE verifier image(s)..."
built=0 skipped=0
for t in "${TASKS[@]}"; do
  dir="$TASKS_DIR/$t"
  if [ ! -f "$dir/environment/Dockerfile" ]; then
    echo "SKIP  $t (no environment/Dockerfile)"
    skipped=$((skipped + 1))
    continue
  fi
  tag="$(tag_for "$t")"
  echo "---- docker build -t $tag"
  docker build -q -t "$tag" -f "$dir/environment/Dockerfile" "$dir/environment"
  built=$((built + 1))
done

echo "Done: $built built, $skipped skipped."
if [ "$built" -eq 0 ]; then
  echo "error: nothing built" >&2
  exit 1
fi
