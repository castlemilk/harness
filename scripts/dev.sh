#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo "Starting Omega Harness dev environment..."

pnpm db:migrate

pnpm --filter @omega/server dev &
SERVER_PID=$!

cleanup() {
  echo "Shutting down server ($SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for the API to be ready
for i in {1..30}; do
  if curl -fs http://localhost:4000/projects >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

pnpm --filter @omega/web dev
