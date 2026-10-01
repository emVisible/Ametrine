"""add inference_role_binding

Revision ID: c7e2a58f1b34
Revises: a4f1c07b9d2e
Create Date: 2026-09-30

additive：只加一张表，不动任何已有列。

表内容只有「角色 → model_uid」的指向关系。模型清单 / 状态 / 显存 / launch 参数 /
维度都不进库 —— 那些 xinference 的 API 现算就有（见 docs/DESIGN-2026-09-30-…md 的实测清单），
抄一份进来就是第二个事实源。

幂等判断是必需的而不是防御性的：这个应用的 lifespan 会跑 Base.metadata.create_all()，
所以新表通常在第一次启动时就被建出来了，迁移再跑会撞 already exists。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e2a58f1b34"
down_revision: Union[str, Sequence[str], None] = "a4f1c07b9d2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    if sa.inspect(bind).has_table("inference_role_binding"):
        return
    op.create_table(
        "inference_role_binding",
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("model_uid", sa.String(length=128), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("role"),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["user.id"], ondelete="SET NULL"
        ),
    )


def downgrade() -> None:
    op.drop_table("inference_role_binding")
