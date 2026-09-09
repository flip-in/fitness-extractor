#!/bin/bash
# Runs ON THE NAS as the forced command for the deploy key:
#   restrict,command="/volume2/docker/fitness-extractor/receive-deploy.sh" ssh-ed25519 ...
#
# The client's requested command arrives in $SSH_ORIGINAL_COMMAND and must be a
# git short sha (the image tag). stdin is either a tar (image.tar.gz,
# docker-compose.yml, receive-deploy.sh, backup.sh, migrate.sh, migrations/) or
# empty for a rollback to a tag already loaded. Prints "previous=<tag>" for the
# caller. Pending migrations are applied before the app starts (migrate.sh);
# they are additive, so a rollback keeps the newer schema.
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
BUNDLE=0
if IFS= read -r -n1 -d '' first; then
  BUNDLE=1
  echo "receiving bundle" >&2
  # The bundle's migrations/ replaces the old set, it does not overlay it: a
  # file dropped or renamed on master must not linger here and keep failing.
  rm -f "$APP"/migrations/*.sql
  { printf '%s' "$first"; cat; } | tar -xf - -C "$APP"
  chmod +x "$APP/receive-deploy.sh" "$APP/backup.sh" "$APP/migrate.sh"
  echo "loading $IMAGE:$TAG" >&2
  gunzip -c "$APP/image.tar.gz" | "$DOCKER" load >&2
  rm -f "$APP/image.tar.gz"
elif ! "$DOCKER" image inspect "$IMAGE:$TAG" >/dev/null 2>&1; then
  echo "refused: $IMAGE:$TAG not present locally and nothing on stdin" >&2
  exit 3
fi

PREV=$(sed -n 's/^TAG=//p' .env 2>/dev/null || true)
echo "previous=${PREV:-none}"

# Schema first, app second: the new image never runs against an old schema.
# Only for a received bundle: a rollback must not be blocked by the failing
# migration it is rolling back from (migrations are additive; the old image
# runs fine on the newer schema). A failed migration exits here (set -e): the
# old app keeps running and .env still names its tag, so deploy.sh reports the
# failure instead of smoke-testing the old app.
if [ "$BUNDLE" = 1 ]; then
  "$DOCKER" compose up -d db >&2
  # Over TCP on purpose: on a fresh volume the entrypoint's temporary init server
  # (socket only) answers `pg_isready` while docker-entrypoint-initdb.d is still
  # applying 001–003; the real server is the first to listen on TCP. Bounded, so
  # a dead DB fails the deploy instead of hanging the forced-command session.
  for i in $(seq 1 60); do
    if "$DOCKER" compose exec -T db pg_isready -q -h localhost -U postgres >/dev/null 2>&1; then break; fi
    if [ "$i" = 60 ]; then echo "refused: db not ready after 120s" >&2; exit 4; fi
    sleep 2
  done
  "$APP/migrate.sh" "$APP/migrations" "$DOCKER" compose exec -T db psql -U postgres -d fitness >&2
fi

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
