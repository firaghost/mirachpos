#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-"$HOME/backups/mirachpos"}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
MYSQL_HOST=${MYSQL_HOST:-"localhost"}
MYSQL_PORT=${MYSQL_PORT:-"3306"}
MYSQL_USER=${MYSQL_USER:-""}
MYSQL_PASSWORD=${MYSQL_PASSWORD:-""}
MYSQL_DATABASE=${MYSQL_DATABASE:-""}

if [[ -z "$MYSQL_USER" || -z "$MYSQL_DATABASE" ]]; then
  echo "Missing MYSQL_USER or MYSQL_DATABASE. Set env vars before running." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/${MYSQL_DATABASE}_${TS}.sql.gz"

if [[ -n "$MYSQL_PASSWORD" ]]; then
  export MYSQL_PWD="$MYSQL_PASSWORD"
fi

mysqldump \
  --host="$MYSQL_HOST" \
  --port="$MYSQL_PORT" \
  --user="$MYSQL_USER" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  "$MYSQL_DATABASE" \
  | gzip -9 > "$OUT_FILE"

unset MYSQL_PWD

find "$BACKUP_DIR" -type f -name "${MYSQL_DATABASE}_*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "Backup completed: $OUT_FILE"
