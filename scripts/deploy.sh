#!/usr/bin/env bash
# Deploy the current master commit to the NAS.
#
#   ./scripts/deploy.sh                 # build, ship, start, smoke-test
#   ./scripts/deploy.sh --allow-empty   # first deploy: smoke test tolerates an empty DB
#   ./scripts/deploy.sh --rollback abc1234   # restart an image tag already on the NAS
#
# Builds linux/amd64 on this machine (the NAS has no git/node and a slow CPU),
# then streams one tar — image + compose + NAS scripts — over a dedicated,
# restricted SSH key to receive-deploy.sh on the NAS. Nothing is built there.
# Design: docs/superpowers/specs/2026-09-08-nas-deployment-design.md §3.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOST=${FITNESS_NAS_HOST:-ceres}
KEY=${FITNESS_DEPLOY_KEY:-$HOME/.ssh/fitness-deploy}
URL=${FITNESS_NAS_URL:-http://100.121.150.120:3000}
IMAGE=fitness-extractor
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST")

SMOKE_ARGS=(--dashboard)
ROLLBACK_TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-empty) SMOKE_ARGS+=(--allow-empty); shift ;;
    --rollback) ROLLBACK_TAG=$2; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

wait_healthy() {
  echo "Waiting for $URL/api/health ..."
  for _ in $(seq 1 30); do
    if curl -sf "$URL/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Backend did not become healthy in 60s" >&2
  return 1
}

smoke() {
  if "$ROOT/scripts/smoke-test.py" "$URL" "${SMOKE_ARGS[@]}"; then
    echo "Deployed $1"
  else
    echo
    echo "SMOKE TEST FAILED for $1. Previous tag: ${2:-unknown}" >&2
    echo "Rollback: ./scripts/deploy.sh --rollback ${2:-<tag>}" >&2
    exit 1
  fi
}

if [ -n "$ROLLBACK_TAG" ]; then
  echo "Rolling back to $ROLLBACK_TAG (no upload)"
  PREV=$("${SSH[@]}" "$ROLLBACK_TAG" </dev/null)
  echo "$PREV"
  wait_healthy
  smoke "$ROLLBACK_TAG"
  exit 0
fi

# Deploys are commits: a rollback target is always a sha, and what runs on the
# NAS is exactly what origin/master says.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree dirty; commit first." >&2; exit 1
fi
git fetch -q origin master
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/master)" ]; then
  echo "HEAD is not origin/master; push (or pull) first." >&2; exit 1
fi

TAG=$(git rev-parse --short HEAD)

# Vite inlines these at build time; read from the root .env.
set -a; source "$ROOT/.env"; set +a
: "${VITE_API_KEY:?VITE_API_KEY missing from .env}"
: "${VITE_MAPBOX_TOKEN:?VITE_MAPBOX_TOKEN missing from .env}"

echo "Building $IMAGE:$TAG for linux/amd64"
docker buildx build --platform linux/amd64 --load \
  --build-arg VITE_API_KEY --build-arg VITE_MAPBOX_TOKEN \
  -t "$IMAGE:$TAG" "$ROOT"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
echo "Saving image"
docker save "$IMAGE:$TAG" | gzip -1 > "$STAGE/image.tar.gz"
cp docker-compose.nas.yml "$STAGE/docker-compose.yml"
cp scripts/nas/receive-deploy.sh scripts/nas/backup.sh "$STAGE/"
mkdir -p "$STAGE/migrations"
cp backend/migrations/*.sql "$STAGE/migrations/"
du -sh "$STAGE/image.tar.gz" | awk '{print "Image", $1}'

echo "Shipping to $HOST"
# Remote command is replaced by the forced command; receive-deploy.sh reads the
# tag from $SSH_ORIGINAL_COMMAND and the tar from stdin.
PREV=$(tar -C "$STAGE" -cf - . | "${SSH[@]}" "$TAG" | tee /dev/stderr | sed -n 's/^previous=//p')

wait_healthy
smoke "$TAG" "$PREV"
