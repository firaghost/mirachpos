#!/usr/bin/env bash
set -euo pipefail

DATE_UTC="$(date -u +%Y%m%d_%H%M%S)"

DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-}"

BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups/mysql}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "${DB_HOST}" || -z "${DB_USER}" || -z "${DB_NAME}" ]]; then
  echo "Missing required env vars: DB_HOST, DB_USER, DB_NAME" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE_UTC}.sql.gz"

if [[ -n "${DB_PASSWORD}" ]]; then
  export MYSQL_PWD="${DB_PASSWORD}"
fi

mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --databases "${DB_NAME}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  | gzip -9 > "${OUT_FILE}"

find "${BACKUP_DIR}" -type f -name "${DB_NAME}_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete

echo "Backup created: ${OUT_FILE}"
