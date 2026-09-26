"""Hand-written DDL used by migrations (things Alembic autogenerate cannot see).

Every new sync-tracked or append-only table must call these helpers in its migration.
"""

# One statement per string: asyncpg cannot run several statements in a single execute().
CREATE_FUNCTIONS = [
    """
CREATE OR REPLACE FUNCTION set_sync_txid() RETURNS trigger AS $$
BEGIN
    -- The writing transaction's id. Pulls only return rows whose txid is older than every
    -- in-flight transaction, so a slow transaction can never be skipped by the cursor.
    NEW.sync_txid := pg_current_xact_id()::text::bigint;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql""",
    """
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql""",
]

DROP_FUNCTIONS = [
    "DROP FUNCTION IF EXISTS set_sync_txid()",
    "DROP FUNCTION IF EXISTS reject_mutation()",
]


def sync_trigger(table: str) -> str:
    return (
        f"CREATE TRIGGER trg_{table}_sync_txid BEFORE INSERT OR UPDATE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION set_sync_txid();"
    )


def drop_sync_trigger(table: str) -> str:
    return f"DROP TRIGGER IF EXISTS trg_{table}_sync_txid ON {table};"


def append_only_trigger(table: str) -> str:
    return (
        f"CREATE TRIGGER trg_{table}_append_only BEFORE UPDATE OR DELETE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION reject_mutation();"
    )


def drop_append_only_trigger(table: str) -> str:
    return f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table};"
