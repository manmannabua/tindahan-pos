#!/usr/bin/env bash
# Tindahan POS — install / upgrade on shared-lemp-vm (Ubuntu 24.04, native, systemd).
#
#   sudo bash install.sh /home/<you>/tindahan-release.tgz
#
# Idempotent: safe to re-run for upgrades. Secrets are generated on the first run and live only
# in /srv/tindahan/.env (mode 600). Touches nothing belonging to other tenants: its own
# PostgreSQL role/database, its own Redis database number (3), its own nginx site, units and
# ports (API 8730, web 3330). See infra/deploy/shared-lemp/README.md.
set -euo pipefail

TARBALL="${1:?usage: install.sh <release tarball>}"
APP=/srv/tindahan
HOME_DIR=/var/lib/tindahan
HOST=tindahan.for-demo.online
SVC_USER=tindahan
REDIS_DB=3
export NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive

log() { printf '\n== %s\n' "$*"; }
as_app() { sudo -u "$SVC_USER" -H env HOME="$HOME_DIR" UV_CACHE_DIR="$HOME_DIR/.cache/uv" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "$*"; }
rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }

log "user + code"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$HOME_DIR" --create-home --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP" "$APP/media" "$APP/var" /var/backups/tindahan /var/cache/nginx/tindahan_public
# Mirror the release into $APP so deleted files disappear too; keep server-only state:
# .env, media, var (celery schedule), the Python venv, node_modules and the web build.
command -v rsync >/dev/null || apt-get install -y -q rsync
STAGE=$(mktemp -d)
tar -xzf "$TARBALL" -C "$STAGE"
rsync -a --delete \
  --exclude='/.env' --exclude='/media/' --exclude='/var/' --exclude='/backend/.venv/' \
  --exclude='node_modules/' --exclude='/frontend/.next/' \
  "$STAGE"/ "$APP"/
rm -rf "$STAGE"
chown -R "$SVC_USER:$SVC_USER" "$APP"
chown postgres:postgres /var/backups/tindahan
chown www-data:www-data /var/cache/nginx/tindahan_public
# nginx serves product photos straight from disk.
chmod 755 "$APP" "$APP/media"

log "secrets / .env"
if [ ! -f "$APP/.env" ]; then
  DB_PASS=$(rand 32); JWT=$(rand 64)
  REDIS_PASS=$(grep -oP '(?<=^requirepass ).+' /etc/redis/redis.conf || true)
  REDIS_AUTH=${REDIS_PASS:+:${REDIS_PASS}@}
  cat > "$APP/.env" <<ENV
ENVIRONMENT=production
LOG_LEVEL=INFO
LOG_JSON=true
DATABASE_URL=postgresql+asyncpg://tindahan:${DB_PASS}@127.0.0.1:5432/tindahan
DB_POOL_SIZE=3
DB_MAX_OVERFLOW=2
REDIS_URL=redis://${REDIS_AUTH}127.0.0.1:6379/${REDIS_DB}
JWT_SECRET=${JWT}
COOKIE_SECURE=true
CORS_ORIGINS='["https://${HOST}"]'
MEDIA_ROOT=${APP}/media
ALLOW_SIGNUP=true
RATE_LIMIT_ENABLED=true
BACKGROUND_JOBS_INLINE=false
# Next.js server (SSR of the public catalog) -> API
API_ORIGIN=http://127.0.0.1:8730
ENV
  chown "$SVC_USER:$SVC_USER" "$APP/.env"; chmod 600 "$APP/.env"
fi
DB_PASS=$(grep -oP '(?<=tindahan:)[^@]+' "$APP/.env")

log "postgres (shared instance: own role + database only)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='tindahan'" | grep -q 1; then
  sudo -u postgres psql -q -c "CREATE ROLE tindahan LOGIN PASSWORD '${DB_PASS}' CONNECTION LIMIT 15"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='tindahan'" | grep -q 1; then
  sudo -u postgres psql -q -c "CREATE DATABASE tindahan OWNER tindahan"
fi
sudo -u postgres psql -q -d tindahan -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"

log "backend: python deps + migrations"
as_app "cd $APP/backend && uv sync --frozen --no-dev --quiet"
as_app "cd $APP/backend && set -a && . $APP/.env && set +a && .venv/bin/alembic upgrade head"

log "demo data (first install only)"
if [ ! -f /root/tindahan-demo.txt ]; then
  # seed-dev refuses production on purpose; the demo company is intended here, so run it once
  # as development against the same database.
  as_app "cd $APP/backend && set -a && . $APP/.env && set +a && ENVIRONMENT=development .venv/bin/python -m app.cli seed-dev >/dev/null"
  # The documented demo password is public: replace it on this internet-facing box.
  CREDS=""
  for user in owner manager cashier1 cashier2 stock; do
    PASS="Tp$(rand 18)7"
    as_app "cd $APP/backend && set -a && . $APP/.env && set +a && POS_PASSWORD='$PASS' .venv/bin/python -m app.cli set-password ${user}@demo.example.com >/dev/null"
    CREDS+="${user}@demo.example.com ${PASS}"$'\n'
  done
  (umask 077; printf '%s' "$CREDS" > /root/tindahan-demo.txt)
fi

log "web build (CPU-capped, low priority)"
corepack enable
BUILD_ID=$(cat "$APP/RELEASE" 2>/dev/null || date +%s)
systemd-run --quiet --wait --collect --pipe -p CPUQuota=60% -p MemoryMax=2G -p Nice=15 \
  --uid="$SVC_USER" --gid="$SVC_USER" -p WorkingDirectory="$APP/frontend" \
  -E HOME="$HOME_DIR" -E COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -E NEXT_TELEMETRY_DISABLED=1 \
  -E API_ORIGIN=http://127.0.0.1:8730 -E NEXT_PUBLIC_BUILD_ID="$BUILD_ID" \
  bash -c "pnpm install --frozen-lockfile --silent && pnpm build"
STANDALONE="$APP/frontend/.next/standalone"
rm -rf "$STANDALONE/.next/static" "$STANDALONE/public"
cp -r "$APP/frontend/.next/static" "$STANDALONE/.next/static"
cp -r "$APP/frontend/public" "$STANDALONE/public"
chown -R "$SVC_USER:$SVC_USER" "$APP"

log "systemd"
install -m 644 "$APP"/infra/deploy/shared-lemp/systemd/tindahan-*.service /etc/systemd/system/
systemctl daemon-reload
for s in api worker web; do systemctl enable --quiet "tindahan-$s"; systemctl restart "tindahan-$s"; done
install -m 644 "$APP/infra/deploy/shared-lemp/tindahan-backup.cron" /etc/cron.d/tindahan-backup

log "nginx + TLS"
if [ ! -f "/etc/letsencrypt/live/$HOST/fullchain.pem" ]; then
  # ACME-only port-80 block first; the full site needs the certificate to exist.
  cat > /etc/nginx/sites-available/tindahan <<NG
server { listen 80; listen [::]:80; server_name ${HOST};
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 404; } }
NG
  ln -sf /etc/nginx/sites-available/tindahan /etc/nginx/sites-enabled/tindahan
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
fi
install -m 644 "$APP/infra/deploy/shared-lemp/nginx-tindahan.conf" /etc/nginx/sites-available/tindahan
ln -sf /etc/nginx/sites-available/tindahan /etc/nginx/sites-enabled/tindahan
nginx -t && systemctl reload nginx

log "health"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8730/api/v1/health >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:8730/api/v1/health && echo
systemctl is-active tindahan-api tindahan-worker tindahan-web nginx postgresql redis-server mysql php8.3-fpm tankerwatch-api homeschool-api
