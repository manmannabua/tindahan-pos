#!/usr/bin/env bash
# Nightly PostgreSQL backup (custom format) with retention and an optional off-site copy.
#
#   crontab: 30 2 * * * /opt/pos/infra/scripts/backup.sh >> /var/log/pos-backup.log 2>&1
#
# Environment (e.g. from /opt/pos/.env.prod):
#   POSTGRES_USER, POSTGRES_DB           database to dump (via the `postgres` compose service)
#   BACKUP_DIR        default /var/backups/pos
#   RETENTION_DAYS    default 30
#   OFFSITE_TARGET    optional: rclone remote, e.g. "b2:my-bucket/pos" (requires rclone)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pos}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE="docker compose -f $(dirname "$0")/../../docker-compose.prod.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/pos_${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
echo "[$(date -u)] dumping ${POSTGRES_DB} → ${FILE}"
# -Fc: compressed custom format, restorable table-by-table with pg_restore.
${COMPOSE} exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${FILE}.partial"
mv "${FILE}.partial" "${FILE}"

# A backup that cannot be read is not a backup: verify the archive's table of contents.
${COMPOSE} exec -T postgres pg_restore --list < "${FILE}" > /dev/null
echo "[$(date -u)] verified $(du -h "${FILE}" | cut -f1)"

if [[ -n "${OFFSITE_TARGET:-}" ]]; then
  rclone copy "${FILE}" "${OFFSITE_TARGET}/" --immutable
  echo "[$(date -u)] copied off-site to ${OFFSITE_TARGET}"
fi

# Product photos live outside the database: archive the media volume too.
MEDIA_FILE="${BACKUP_DIR}/media_${STAMP}.tar.gz"
${COMPOSE} exec -T api tar -czf - -C /app media > "${MEDIA_FILE}"
echo "[$(date -u)] media archived $(du -h "${MEDIA_FILE}" | cut -f1)"
[[ -n "${OFFSITE_TARGET:-}" ]] && rclone copy "${MEDIA_FILE}" "${OFFSITE_TARGET}/" --immutable

find "${BACKUP_DIR}" -name 'media_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name 'pos_*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date -u)] done"
