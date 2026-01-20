#!/bin/bash

# create-worktree.sh - Create a new worktree for parallel development
# Usage: ./scripts/create-worktree.sh [worktree_name] [base_branch]
# If no name provided, generates a unique one
# If no base branch provided, uses current branch

set -e

# Generate unique worktree name
generate_unique_name() {
    local adjectives=("swift" "bright" "clever" "smooth" "quick" "clean" "sharp" "neat" "cool" "fast")
    local nouns=("fix" "task" "work" "dev" "patch" "branch" "code" "build" "test" "run")
    local adj=${adjectives[$RANDOM % ${#adjectives[@]}]}
    local noun=${nouns[$RANDOM % ${#nouns[@]}]}
    local timestamp=$(date +%H%M)
    echo "${adj}_${noun}_${timestamp}"
}

WORKTREE_NAME=${1:-$(generate_unique_name)}
BASE_BRANCH=${2:-$(git branch --show-current)}
REPO_NAME=$(basename "$(pwd)")
WORKTREE_PATH="../${REPO_NAME}-${WORKTREE_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Creating worktree: ${WORKTREE_NAME}"
echo "Location: ${WORKTREE_PATH}"
echo "Base branch: ${BASE_BRANCH}"

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
    echo "Error: Worktree directory already exists: $WORKTREE_PATH"
    exit 1
fi

# Create worktree with new branch or use existing
if git show-ref --verify --quiet "refs/heads/${WORKTREE_NAME}"; then
    echo "Using existing branch: ${WORKTREE_NAME}"
    git worktree add "$WORKTREE_PATH" "$WORKTREE_NAME"
else
    echo "Creating new branch: ${WORKTREE_NAME}"
    git worktree add -b "$WORKTREE_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"
fi

# Run setup script
cd "$WORKTREE_PATH"
echo "Running setup script..."
if ! "${SCRIPT_DIR}/worktree-setup.sh"; then
    echo "Setup failed. Cleaning up..."
    cd - > /dev/null
    git worktree remove --force "$WORKTREE_PATH"
    git branch -D "$WORKTREE_NAME" 2>/dev/null || true
    echo "Worktree removed due to setup failure."
    exit 1
fi

cd - > /dev/null

echo ""
echo "Worktree created successfully!"
echo "Path: ${WORKTREE_PATH}"
echo "Branch: ${WORKTREE_NAME}"
echo ""
echo "To use:  cd ${WORKTREE_PATH}"
echo ""
echo "To remove:"
echo "  git worktree remove ${WORKTREE_PATH}"
echo "  git branch -D ${WORKTREE_NAME}"
