"""managers manage terminal settings

Revision ID: 5ca76ecbb3e4
Revises: 8f9e3d20bc71
Create Date: 2026-09-26 11:49:52.913029+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "5ca76ecbb3e4"
down_revision: str | Sequence[str] | None = "8f9e3d20bc71"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Built-in Store Manager roles may now change terminal settings (auto-print, printer type,
    # scanner tuning) at the counter. Owner-customized roles keep what the owner gave them.
    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission)
        SELECT id, 'settings.manage' FROM roles WHERE code = 'MANAGER' AND is_system
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_permissions WHERE permission = 'settings.manage'
          AND role_id IN (SELECT id FROM roles WHERE code = 'MANAGER' AND is_system)
        """
    )
