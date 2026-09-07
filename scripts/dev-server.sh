#!/bin/bash
# Dev server script for git worktrees
# Finds available ports to avoid conflicts with main repo
#
# Runs the dashboard in the background and the backend in the foreground, both
# sharing this terminal. Ctrl+C takes down both.
#
# Execute this, don't source it — the cleanup below signals the whole process
# group, which would hit your shell if sourced.

set -e

# Tear down the backgrounded dashboard when the backend exits.
#
# Without this, Ctrl+C kills only the foreground backend and vite survives as an
# orphan still holding its port. The next run then picks a different port while
# the backend keeps advertising the old one as its single allowed CORS origin,
# so the dashboard loads but every API call fails with "Failed to fetch".
#
# vite runs as a grandchild of pnpm, so killing the recorded PID is not enough —
# signal the entire process group instead.
cleanup() {
  # EXIT fires again after an INT/TERM handler returns; don't re-enter.
  trap - EXIT INT TERM
  # We're in the group we're about to signal, so ignore our own TERM.
  trap '' TERM
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Find available port starting from base
find_port() {
  local port=$1
  while lsof -i:$port >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo $port
}

# Load API_KEY from .env
if [ -f .env ]; then
  export $(grep -E '^API_KEY=' .env | xargs)
fi

BACKEND_PORT=$(find_port 3000)
DASHBOARD_PORT=$(find_port 5173)

echo "Dashboard: http://localhost:$DASHBOARD_PORT"
echo "Backend API: http://localhost:$BACKEND_PORT"

# Dashboard in background
VITE_API_URL=http://localhost:$BACKEND_PORT VITE_API_KEY=$API_KEY pnpm --filter dashboard exec vite --port $DASHBOARD_PORT &

# Give dashboard a moment to start and print URL
sleep 2

# Backend in foreground
PORT=$BACKEND_PORT CORS_ORIGIN=http://localhost:$DASHBOARD_PORT pnpm dev:backend
