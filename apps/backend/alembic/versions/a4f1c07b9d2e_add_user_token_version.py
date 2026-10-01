"""add user.token_version（会话吊销代号）

Revision ID: a4f1c07b9d2e
Revises: 7b3d5e19c4a2
Create Date: 2026-09-29

JWT 无状态，改角色/停用账号在令牌有效期内不会把任何人踢下线，
此前唯一的吊销手段是轮换 SECRET_KEY（连带登出所有人）。这个列给「单独吊销一个人」一个来源。

additive：只加一列，带 server_default，所以既有行直接得到 0，不需要回填、也不需要停机。
幂等判断同 7b3d5e19c4a2 的理由 —— lifespan 会跑 create_all，
但它只建**新表**、不会给**已存在的表**补列，两种顺序都得能跑。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4f1c07b9d2e"
down_revision: Union[str, Sequence[str], None] = "7b3d5e19c4a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(bind, table: str, column: str) -> bool:
    return any(
        row["name"] == column
        for row in sa.inspect(bind).get_columns(table)
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    if not _has_column(bind, "user", "token_version"):
        op.add_column(
            "user",
            sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    if _has_column(bind, "user", "token_version"):
        op.drop_column("user", "token_version")
