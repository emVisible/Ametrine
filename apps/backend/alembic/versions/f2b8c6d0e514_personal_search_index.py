"""personal ledger trigram index

Personal search is substring search over the append-only text. pg_trgm keeps
it off a sequential scan without pretending Chinese has word boundaries.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "f2b8c6d0e514"
down_revision: Union[str, Sequence[str], None] = "e7c5b2a9d431"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_personal_ledger_text_trgm", "personal_ledger", ["text"],
        unique=False, postgresql_using="gin",
        postgresql_ops={"text": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_personal_ledger_text_trgm", table_name="personal_ledger")
