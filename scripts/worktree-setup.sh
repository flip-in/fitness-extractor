#!/bin/bash
set -e

echo "=== Worktree Setup Script ==="

# Detect main repo path
WORKTREE_DIR="$(pwd)"
if [ -f "$WORKTREE_DIR/.git" ]; then
    # We're in a worktree - extract main repo from .git file
    GIT_DIR=$(cat "$WORKTREE_DIR/.git" | sed 's/gitdir: //')
    MAIN_REPO=$(dirname "$(dirname "$(dirname "$GIT_DIR")")")
else
    # We're in main repo
    MAIN_REPO="$WORKTREE_DIR"
fi

echo "Main repo: $MAIN_REPO"
echo "Current dir: $WORKTREE_DIR"

# Copy .env from main repo if it exists and worktree doesn't have one
if [ -f "$MAIN_REPO/.env" ] && [ ! -f "$WORKTREE_DIR/.env" ]; then
    echo "Copying .env from main repo..."
    cp "$MAIN_REPO/.env" "$WORKTREE_DIR/.env"
elif [ -f "$WORKTREE_DIR/.env" ]; then
    echo ".env already exists in worktree, skipping"
elif [ ! -f "$MAIN_REPO/.env" ]; then
    echo "Warning: No .env in main repo. Copy .env.example to .env and configure."
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "pnpm not found, installing via corepack..."
    corepack enable
    corepack prepare pnpm@10.6.1 --activate
fi

echo "pnpm version: $(pnpm --version)"

# Install dependencies
echo "Installing dependencies..."
pnpm install

echo "=== Setup Complete ==="
