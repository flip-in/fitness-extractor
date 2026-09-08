#!/bin/bash
# Nightly pg_dump, run ON THE NAS by DSM Task Scheduler (user Oberon, 03:00,
# "send run details by email" on abnormal termination).
#
# pgdata lives on volume2, a single SSD with no redundancy; these dumps go to
# volume1 so a drive failure can't take both. 14 days kept. Restore:
#   docker exec -i fitness-db pg_restore -U postgres -d fitness --clean < file.dump
# then run a short "Import Last N Days" from the phone to fill the gap.
set -euo pipefail

DOCKER=/usr/local/bin/docker
DEST=/volume1/homes/Oberon/backups/fitness-extractor
KEEP_DAYS=14

mkdir -p "$DEST"
OUT="$DEST/fitness-$(date +%F).dump"
"$DOCKER" exec fitness-db pg_dump -U postgres -Fc fitness > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$DEST" -name 'fitness-*.dump' -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
