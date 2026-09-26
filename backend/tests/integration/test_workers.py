"""Worker tasks run with the synchronous engine (psycopg)."""

from app.workers.tasks import purge_expired_refresh_tokens


def test_purge_expired_refresh_tokens_runs() -> None:
    # Smoke test: the sync engine connects and the statement is valid. The async test
    # transaction is invisible to this separate connection, so nothing is asserted about rows.
    assert purge_expired_refresh_tokens() >= 0


def test_verify_inventory_balances_task_runs() -> None:
    from app.workers.tasks import verify_inventory_balances_task

    assert verify_inventory_balances_task() >= 0


def test_purge_job_payloads_runs() -> None:
    from app.workers.tasks import purge_job_payloads

    exports, imports = purge_job_payloads()
    assert exports >= 0 and imports >= 0
