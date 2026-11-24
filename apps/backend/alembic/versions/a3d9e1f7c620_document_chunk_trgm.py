"""trigram index for lexical document search

Document answers normally arrive through embeddings. Until those models are
available, the same chunks can still be found by their own words; the index
keeps that fallback from scanning every chunk.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a3d9e1f7c620"
down_revision: Union[str, Sequence[str], None] = "f2b8c6d0e514"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_document_chunk_content_trgm", "document_chunk", ["content"],
        unique=False, postgresql_using="gin",
        postgresql_ops={"content": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_document_chunk_content_trgm", table_name="document_chunk")
