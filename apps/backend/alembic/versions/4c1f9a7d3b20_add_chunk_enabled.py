"""add enabled flag to document_chunk

分块的「停用而不删除」需要一列。向量侧加标量字段要重建集合（既有集合的
schema 是创建时定死的），所以排除逻辑放在读取正文处，这里只补关系库这一列。
server_default 让历史分块保持参与检索 —— 否则迁移一落地，已有知识库全体失效。

Revision ID: 4c1f9a7d3b20
Revises: 8f2089c91e75
Create Date: 2026-09-29 18:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4c1f9a7d3b20'
down_revision: Union[str, Sequence[str], None] = '8f2089c91e75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """只加一列：不改索引、不动既有行。"""
    op.add_column(
        "document_chunk",
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("document_chunk", "enabled")
