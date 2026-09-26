# Deployment

## 1. Production topology (single VM / VPS)

```
Internet ──443──► Nginx (TLS, HSTS, gzip, rate limits)
                    ├── /api/v1/*, /api/v1/ws  ──► FastAPI (uvicorn workers, 127.0.0.1:8000)
                    └── /*                     ──► Next.js (node server, 127.0.0.1:3000)

Private network only:
  PostgreSQL 17  (127.0.0.1:5432 or private subnet)
  Redis 7        (127.0.0.1:6379, password, protected-mode)
  Celery worker(s) + Celery beat
```

- **Never expose PostgreSQL or Redis publicly.** In Docker Compose they have no `ports:`
  mapping in production; on a VM they bind to localhost/private IP and the firewall (ufw)
  allows only 22, 80, 443.
- One origin (`https://pos.example.com`) serves both the app and `/api` — no CORS, first-party
  cookies, simpler CSP.
- Nginx config: `infra/nginx/pos.conf`. WebSocket upgrade headers for `/api/v1/ws`.
  The service worker (`/serwist/sw.js`) is served with `Cache-Control: no-cache` so updates
  are picked up.

## 2. Processes

| Process | Command | Scale |
|---|---|---|
| API | `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4` (or `uvicorn --workers 4`) | ~2 × CPU cores |
| Worker | `celery -A app.workers.celery_app worker -l info` | 1+ |
| Scheduler | `celery -A app.workers.celery_app beat -l info` | exactly 1 |
| Web | `node .next/standalone/server.js` | 1–2 |
| Migrations | `alembic upgrade head` | run once per deploy, before API starts |

Run under Docker Compose (`docker-compose.prod.yml`) or systemd units.

## 3. Deploy procedure

1. Back up the database (`pg_dump -Fc`).
2. Pull new images / code.
3. `alembic upgrade head` (migrations must be backward-compatible with the running version:
   add columns nullable first, backfill, then constrain in a later release).
4. Restart API and workers (rolling if more than one instance).
5. Deploy the frontend. Terminals pick up the new service worker on next load; the POS shows
   "Update available — reload when idle" instead of reloading mid-sale.

**Compatibility rule:** the sync API must accept payloads from the previous POS version,
because offline terminals may push old-format operations days later. Payloads carry a
`schema_version`.

## 4. Backups

- `infra/scripts/backup.sh` (cron, nightly): `pg_dump -Fc`, verifies the archive with
  `pg_restore --list`, optional off-site copy with rclone, 30-day retention.
- `infra/scripts/restore.sh`: restores into a **new** database and prints sanity counts; the
  switch-over is a deliberate manual step. Practice it (e.g. monthly).
- Nightly `pg_dump -Fc` to off-site object storage, 30-day retention; weekly restore test.
- For point-in-time recovery: WAL archiving (pgBackRest or wal-g). Recommended once the
  business depends on the system.
- Redis is not backed up (no source-of-truth data).
- Terminals are also a partial backup: unsynced operations can be exported from a device.

## 5. Logging & monitoring

- Structured JSON logs (structlog) with `request_id`, `company_id`, `device_id`.
- Health: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (DB + Redis).
- Metrics to watch: sync push latency, `DEFERRED/REJECTED` counts, devices not synced > 1 h,
  open review flags, Celery queue length, PostgreSQL connections, disk.
- Error tracking: Sentry (backend + frontend) recommended; DSN via env.
- Celery monitoring: Flower (behind auth, never public).

## 6. TLS

Let's Encrypt via certbot (`certbot --nginx`) or Caddy as an alternative reverse proxy.
The PWA **requires HTTPS** (service workers and WebCrypto only run in secure contexts;
`localhost` is exempt for development).

## 7. Local development

See the root [README.md](../README.md): either `docker compose up` or run PostgreSQL/Redis
natively and start `uvicorn`, `celery` and `next dev` individually.
