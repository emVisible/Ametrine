"""add message_feedback table

Revision ID: 7b3d5e19c4a2
Revises: 4c1f9a7d3b20
Create Date: 2026-09-29

只加一张新表，不动任何已有列（additive）。
`message.status` 不需要迁移：它早就存在，本轮开始真正写它和读它。
历史 80 行全是 'done' —— 那是「没记过」而不是「都答对了」，所以不做任何回填美化。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "7b3d5e19c4a2"
down_revision: Union[str, Sequence[str], None] = "4c1f9a7d3b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 这个应用在 lifespan 里跑 Base.metadata.create_all()，所以新表往往先被启动建出来了，
    # 迁移再跑就会撞 already exists。这里显式幂等，是为了让「跑迁移」这件事在
    # 两种启动顺序下都成立 —— 而不是只有第一次干净库上成立。
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    if sa.inspect(bind).has_table("message_feedback"):
        return
    op.create_table(
        "message_feedback",
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("message.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("verdict", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("message_id"),
    )
    op.create_index(
        "ix_message_feedback_user_id", "message_feedback", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_message_feedback_user_id", table_name="message_feedback")
    op.drop_table("message_feedback")
