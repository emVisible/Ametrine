"""explicit personal batch/ingest job log"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4f1a8d2e736"
down_revision: Union[str, Sequence[str], None] = "b8e4f2c6a917"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "personal_job",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenant.id"),
                  nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False,
                  server_default="running"),
        sa.Column("requested_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("meta", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_personal_job_tenant_id", "personal_job", ["tenant_id"])
    op.create_index("ix_personal_job_id", "personal_job", ["id"])


def downgrade() -> None:
    op.drop_index("ix_personal_job_id", table_name="personal_job")
    op.drop_index("ix_personal_job_tenant_id", table_name="personal_job")
    op.drop_table("personal_job")
