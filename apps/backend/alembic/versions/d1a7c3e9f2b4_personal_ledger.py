"""personal ledger and tenant mode

Adds the append-only personal truth table and the two tenant fields that decide
which assistant a workspace lands on. Existing tenants stay knowledge/rag.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1a7c3e9f2b4"
down_revision: Union[str, Sequence[str], None] = "c7e2a58f1b34"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("mode", sa.String(length=16), nullable=False,
                  server_default="knowledge"),
    )
    op.add_column(
        "tenant",
        sa.Column("default_assistant", sa.String(length=16), nullable=False,
                  server_default="rag"),
    )
    op.create_table(
        "personal_ledger",
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("prev", sa.String(length=64), nullable=False),
        sa.Column("hash", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provenance", postgresql.JSONB(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tenant_id", "seq"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_personal_ledger_tenant_id"),
    )
    op.create_index("ix_personal_ledger_tenant_time", "personal_ledger",
                    ["tenant_id", "occurred_at"])
    op.create_index("ix_personal_ledger_tenant_kind", "personal_ledger",
                    ["tenant_id", "kind"])


def downgrade() -> None:
    op.drop_index("ix_personal_ledger_tenant_kind", table_name="personal_ledger")
    op.drop_index("ix_personal_ledger_tenant_time", table_name="personal_ledger")
    op.drop_table("personal_ledger")
    op.drop_column("tenant", "default_assistant")
    op.drop_column("tenant", "mode")
