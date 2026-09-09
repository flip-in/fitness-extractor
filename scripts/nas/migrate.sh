#!/bin/bash
# Apply pending backend/migrations/NNN_*.sql to the fitness database.
#
#   migrate.sh <migrations-dir> <psql command...>
#   e.g. migrate.sh ./migrations /usr/local/bin/docker exec -i fitness-db psql -U postgres -d fitness
#
# A file is pending when its NNN prefix has no row in schema_migrations. Files
# run in order, each in one transaction (ON_ERROR_STOP), and the version row is
# inserted afterwards if the file did not insert it itself (002_seed_user.sql
# does not). Fresh volumes are still initialised by docker-entrypoint-initdb.d;
# this covers every deploy after that. Called by receive-deploy.sh between
# `compose up db` and `compose up app`, so a new image never runs on an old schema.
set -euo pipefail

DIR=$1; shift
PSQL=("$@")

applied=$("${PSQL[@]}" -tAX -c "SELECT version FROM schema_migrations" 2>/dev/null || true)

for file in "$DIR"/[0-9][0-9][0-9]_*.sql; do
  [ -e "$file" ] || { echo "migrate: no migration files in $DIR" >&2; exit 1; }
  name=$(basename "$file")
  version=$((10#${name:0:3}))
  if grep -qx "$version" <<<"$applied"; then continue; fi
  echo "migrate: applying $name"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -X -q --single-transaction -f - <"$file"
  "${PSQL[@]}" -X -q -c "INSERT INTO schema_migrations (version, description) VALUES ($version, '$name') ON CONFLICT DO NOTHING"
done
echo "migrate: schema at version $("${PSQL[@]}" -tAX -c "SELECT max(version) FROM schema_migrations")"
