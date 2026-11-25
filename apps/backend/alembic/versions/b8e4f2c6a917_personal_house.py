"""read-only house snapshot

House was never writable through Isla's HTTP API; one snapshot keeps that
boundary visible instead of inventing six write models.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8e4f2c6a917"
down_revision: Union[str, Sequence[str], None] = "a3d9e1f7c620"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "personal_house",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(),
                  sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("source", sa.String(length=255), nullable=False,
                  server_default="house/truth.db"),
        sa.Column("imported_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("data", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_personal_house_id", "personal_house", ["id"],
                    unique=False)
    op.create_index("ix_personal_house_tenant_id", "personal_house",
                    ["tenant_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_personal_house_tenant_id", table_name="personal_house")
    op.drop_index("ix_personal_house_id", table_name="personal_house")
    op.drop_table("personal_house")
