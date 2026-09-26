"""Celery application.

Celery tasks are synchronous functions. Simple tasks use a synchronous SQLAlchemy session
(`get_sync_sessionmaker`). Tasks that need existing async service logic call it through
`app.workers.runtime.run_async` instead of re-implementing it.

Checkout never depends on Celery: tasks are for reports, imports/exports, notifications,
recalculations and scheduled maintenance.

Run:
    celery -A app.workers.celery_app worker -l info            (Linux/macOS)
    celery -A app.workers.celery_app worker -l info --pool=solo  (Windows dev)
    celery -A app.workers.celery_app beat -l info
"""

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "pos",
    broker=settings.broker_url,
    backend=settings.celery_result_backend,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # A task is acknowledged only after it finishes, so a crashed worker's task is redelivered.
    # Tasks must therefore be idempotent.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "purge-expired-refresh-tokens": {
            "task": "maintenance.purge_expired_refresh_tokens",
            "schedule": crontab(hour=3, minute=15),
        },
        "purge-job-payloads": {
            "task": "maintenance.purge_job_payloads",
            "schedule": crontab(hour=3, minute=45),
        },
        "verify-inventory-balances": {
            "task": "inventory.verify_balances",
            "schedule": crontab(hour=2, minute=30),
        },
    },
)
