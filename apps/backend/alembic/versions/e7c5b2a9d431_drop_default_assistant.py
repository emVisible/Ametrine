"""drop default_assistant

Isla is the system, not a selectable assistant. The column encoded a choice
that should not exist; mode remains the business boundary.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7c5b2a9d431"
down_revision: Union[str, Sequence[str], None] = "d1a7c3e9f2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("tenant", "default_assistant")


def downgrade() -> None:
    op.add_column(
        "tenant",
        sa.Column("default_assistant", sa.String(length=16), nullable=False,
                  server_default="rag"),
    )
