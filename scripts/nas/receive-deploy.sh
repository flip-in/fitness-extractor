#!/bin/bash
# Runs ON THE NAS as the forced command for the deploy key:
#   restrict,command="/volume2/docker/fitness-extractor/receive-deploy.sh" ssh-ed25519 ...
#
# The client's requested command arrives in $SSH_ORIGINAL_COMMAND and must be a
# git short sha (the image tag). stdin is either a tar (image.tar.gz,
# docker-compose.yml, receive-deploy.sh, backup.sh, migrations/) or empty for a
# rollback to a tag already loaded. Prints "previous=<tag>" for the caller.
#
# Absolute paths: non-interactive DSM SSH does not have /usr/local/bin on PATH.
set -euo pipefail

APP=/volume2/docker/fitness-extractor
DOCKER=/usr/local/bin/docker
IMAGE=fitness-extractor
KEEP=3

TAG=${SSH_ORIGINAL_COMMAND:-}
if ! [[ "$TAG" =~ ^[0-9a-f]{7,12}$ ]]; then
  echo "refused: expected an image tag, got '${TAG}'" >&2
  exit 2
fi

cd "$APP"

# Was anything streamed? Read the first byte; if none, this is a rollback.
if IFS= read -r -n1 -d '' first; then
  echo "receiving bundle" >&2
  { printf '%s' "$first"; cat; } | tar -xf - -C "$APP"
  chmod +x "$APP/receive-deploy.sh" "$APP/backup.sh"
  echo "loading $IMAGE:$TAG" >&2
  gunzip -c "$APP/image.tar.gz" | "$DOCKER" load >&2
  rm -f "$APP/image.tar.gz"
elif ! "$DOCKER" image inspect "$IMAGE:$TAG" >/dev/null 2>&1; then
  echo "refused: $IMAGE:$TAG not present locally and nothing on stdin" >&2
  exit 3
fi

PREV=$(sed -n 's/^TAG=//p' .env 2>/dev/null || true)
echo "previous=${PREV:-none}"

# Pin the tag compose will run.
if grep -q '^TAG=' .env 2>/dev/null; then
  sed -i "s/^TAG=.*/TAG=$TAG/" .env
else
  echo "TAG=$TAG" >> .env
fi

"$DOCKER" compose up -d --remove-orphans >&2

# Keep the newest $KEEP tags so rollback has something to go back to.
"$DOCKER" images "$IMAGE" --format '{{.Tag}} {{.CreatedAt}}' \
  | sort -k2 -r | awk -v keep="$KEEP" 'NR>keep {print $1}' \
  | while read -r old; do
      [ "$old" = "$TAG" ] && continue
      "$DOCKER" rmi "$IMAGE:$old" >&2 || true
    done

echo "running=$TAG"
