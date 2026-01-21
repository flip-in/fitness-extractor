#!/bin/bash
# Dev server script for git worktrees
# Finds available ports to avoid conflicts with main repo

set -e

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

echo "Backend API: http://localhost:$BACKEND_PORT"
echo "Dashboard: http://localhost:$DASHBOARD_PORT"

# Backend in background
PORT=$BACKEND_PORT CORS_ORIGIN=http://localhost:$DASHBOARD_PORT pnpm dev:backend &

# Give backend a moment to start
sleep 1

# Dashboard in foreground
VITE_API_URL=http://localhost:$BACKEND_PORT VITE_API_KEY=$API_KEY pnpm --filter dashboard exec vite --port $DASHBOARD_PORT
