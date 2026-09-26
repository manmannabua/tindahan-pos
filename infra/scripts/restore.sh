#!/usr/bin/env bash
# Restore a backup into a NEW database, verify it, then (manually) switch over.
#
#   ./restore.sh /var/backups/pos/pos_20260926T023000Z.dump pos_restore
#
# Restoring into a separate database first means a bad backup can never destroy the live one.
# Practice this regularly: an untested backup is a hope, not a backup.
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file> <target-db>}"
TARGET_DB="${2:?usage: restore.sh <dump-file> <target-db>}"
COMPOSE="docker compose -f $(dirname "$0")/../../docker-compose.prod.yml"

${COMPOSE} exec -T postgres createdb -U "${POSTGRES_USER}" "${TARGET_DB}"
${COMPOSE} exec -T postgres pg_restore -U "${POSTGRES_USER}" -d "${TARGET_DB}" --no-owner < "${DUMP}"

echo "Restored into ${TARGET_DB}. Sanity checks:"
${COMPOSE} exec -T postgres psql -U "${POSTGRES_USER}" -d "${TARGET_DB}" -c \
  "SELECT (SELECT count(*) FROM sales) AS sales,
          (SELECT count(*) FROM inventory_movements) AS movements,
          (SELECT max(received_at) FROM sales) AS latest_sale,
          (SELECT version_num FROM alembic_version) AS schema_version;"

cat <<'EOF'
To switch over (downtime of a few seconds):
  1. docker compose -f docker-compose.prod.yml stop api worker beat
  2. psql: ALTER DATABASE pos RENAME TO pos_old; ALTER DATABASE <target> RENAME TO pos;
  3. docker compose -f docker-compose.prod.yml start api worker beat
Terminals keep selling offline during the switch and sync afterwards (idempotent push).
Sales that reached the old database after the backup was taken exist only there and on the
terminals: terminals re-push nothing already acknowledged, so export them from pos_old
(sales.received_at > backup time) before dropping it.
EOF
