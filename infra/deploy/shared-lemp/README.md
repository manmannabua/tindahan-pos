# Tindahan POS on shared-lemp-vm (demo)

`https://tindahan.for-demo.online` — a **demo** deployment on the shared GCP VM
(`shared-lemp-vm`, `asia-southeast1-b`, 34.87.135.205; 2 vCPU / 8 GB, 13+ other tenants).
Native (systemd), no Docker, following the house conventions of the neighbours (see
`oil-tanker/infra/deploy`). For real stores use a dedicated server with
`docker-compose.prod.yml` or these same scripts on a box of its own.

## Layout on the host

| Thing | Value |
|---|---|
| Code | `/srv/tindahan/{backend,frontend,infra}` (user `tindahan`, home `/var/lib/tindahan`) |
| Secrets | `/srv/tindahan/.env` (600) — generated on first install |
| Photos | `/srv/tindahan/media` (nginx serves `/api/v1/media/` from disk) |
| Services | `tindahan-api` (uvicorn, 2 workers, `127.0.0.1:8730`), `tindahan-worker` (Celery + beat, 1 process), `tindahan-web` (Next.js standalone, `127.0.0.1:3330`) |
| Limits | CPU/memory capped per unit (API 450 MB, worker 300 MB, web 350 MB) |
| PostgreSQL | shared 16 instance; own role/database `tindahan`, role `CONNECTION LIMIT 15`; app pool 3+2 per API worker (the instance allows 40 in total) |
| Redis | shared, password from `/etc/redis/redis.conf`; **database 3** (0 = Tanker Watch, 15 = Homeschool) |
| nginx | `/etc/nginx/sites-available/tindahan`; zones/cache named `tindahan_*` |
| TLS | Let's Encrypt HTTP-01 (webroot `/var/www/html`), auto-renewed by certbot |
| Backups | `/etc/cron.d/tindahan-backup` → `/var/backups/tindahan` (DB 03:30, photos 03:40, 7-day by weekday) |
| DNS | Cloudflare `for-demo.online`: `A tindahan → 34.87.135.205`, DNS-only (not proxied) |
| Demo logins | `/root/tindahan-demo.txt` (random passwords set at first install; PINs as in `seed-dev`) |

## Deploy / upgrade

```bash
# on your PC (committed tree only)
bash infra/deploy/shared-lemp/package-release.sh
gcloud compute scp dist/tindahan-release.tgz infra/deploy/shared-lemp/install.sh \
  shared-lemp-vm:~ --zone=asia-southeast1-b
gcloud compute ssh shared-lemp-vm --zone=asia-southeast1-b \
  --command='sudo bash ~/install.sh ~/tindahan-release.tgz'
```

`install.sh` is idempotent: it mirrors the release into `/srv/tindahan`, runs migrations,
builds the web app on the box (CPU-capped at 60 %, nice 15 — a Windows build would bundle
Windows-only native modules), restarts the three units and reloads nginx. It touches no other
tenant's files, database, Redis database or units.

## Operate

```bash
systemctl status tindahan-api tindahan-worker tindahan-web
journalctl -u tindahan-api -f
sudo -u tindahan bash -c 'cd /srv/tindahan/backend && set -a && . ../.env && set +a && \
  POS_PASSWORD=... .venv/bin/python -m app.cli set-password owner@demo.example.com'
```
