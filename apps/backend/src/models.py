from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    BigInteger,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from src.client import Base


class Role(Base):
    __tablename__ = "role"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    members = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(30), unique=True, index=True, nullable=False)
    password = Column(String(256), nullable=False)

    email = Column(String(255), unique=True, index=True, nullable=True)
    avatar_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    role_id = Column(Integer, ForeignKey("role.id"), default=1)
    role = relationship("Role", back_populates="members")

    # 会话吊销用的代号，随「身份相关字段」变更而自增。
    # 为什么需要它：JWT 是无状态的，改角色/停用账号在令牌有效期内**不会**把任何人踢下线，
    # 而在此之前唯一的吊销手段是轮换 SECRET_KEY —— 那会把所有账号一起登出。
    # 令牌里带 `tv`，校验时和库里的值比一次，就等于把「吊销」变成一个每次请求都会看的判断。
    # server_default 必须有：这个列要出现在既有账号的行上，而 lifespan 的 create_all
    # 不会给已存在的表补列（补列靠迁移），没有默认值的 NULL 会让每次校验都要特判。
    token_version = Column(Integer, nullable=False, server_default="0", default=0)

    tenant_id = Column(Integer, ForeignKey("tenant.id"), nullable=True, index=True)
    tenant = relationship("Tenant", back_populates="users")

    daily_token_limit = Column(Integer, default=100000)
    daily_token_used = Column(Integer, default=0)
    monthly_token_limit = Column(Integer, default=3000000)
    monthly_token_used = Column(Integer, default=0)
    total_token_used = Column(BigInteger, default=0)

    preferences = Column(JSONB, default=dict)
    system_prompt = Column(Text, nullable=True)

    milvus_collection_prefix = Column(String(64), nullable=True)

    conversations = relationship("Conversation", back_populates="user")
    memory_items = relationship("MemoryItem", back_populates="user")
    audio_assets = relationship("AudioAsset", back_populates="user")


# src/models.py — Tenant
class Tenant(Base):
    __tablename__ = "tenant"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    database_id = Column(Integer, ForeignKey("database.id"), unique=True, nullable=True)
    database = relationship("Database", back_populates="tenant", cascade="all, delete")
    users = relationship("User", back_populates="tenant")


class Database(Base):
    __tablename__ = "database"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    tenant = relationship("Tenant", back_populates="database", uselist=False)
    collections = relationship(
        "Collection", back_populates="database", cascade="all, delete"
    )


class Collection(Base):
    __tablename__ = "collection"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String, nullable=True)

    documents = relationship(
        "Document", back_populates="collection", cascade="all, delete"
    )
    database_id = Column(Integer, ForeignKey("database.id"))
    database = relationship("Database", back_populates="collections")


class Document(Base):
    __tablename__ = "document"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    title = Column(String, index=True)
    uploader = Column(String, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    meta = Column(JSONB, nullable=True)

    collection_id = Column(Integer, ForeignKey("collection.id"), index=True)
    collection = relationship("Collection", back_populates="documents")
    chunks = relationship(
        "DocumentChunk", back_populates="document", cascade="all, delete"
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunk"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text)
    # 停用而不删除：向量侧没有 enabled 标量字段（集合 schema 是既有的，
    # 加字段要重建集合），所以排除放在读取正文这一层（chunk_get_many_service），
    # 检索召回的 (doc_id, chunk_id) 到那里查不到行就等于不存在。
    # 用 server_default 是为了让已有的 9 条历史分块默认参与检索，而不是全部消失。
    enabled = Column(Boolean, nullable=False, server_default=text("true"))

    doc_id = Column(UUID(as_uuid=True), ForeignKey("document.id"))
    document = relationship("Document", back_populates="chunks")


class Conversation(Base):
    __tablename__ = "conversation"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    title = Column(String, index=True)
    mode = Column(String, index=True, default="llm")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    archived_at = Column(DateTime(timezone=True), nullable=True)
    meta = Column(JSONB, nullable=True)

    user = relationship("User", back_populates="conversations")
    user_id = Column(Integer, ForeignKey("user.id"), nullable=True, index=True)
    messages = relationship(
        "Message", back_populates="conversation", cascade="all, delete"
    )
    tool_calls = relationship(
        "ToolCall", back_populates="conversation", cascade="all, delete"
    )


class Message(Base):
    __tablename__ = "message"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    role = Column(String, index=True)
    content = Column(Text)
    status = Column(String, index=True, default="done")
    model = Column(String, nullable=True)
    token_usage = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    meta = Column(JSONB, nullable=True)

    conversation_id = Column(
        UUID(as_uuid=True), ForeignKey("conversation.id"), index=True
    )
    conversation = relationship("Conversation", back_populates="messages")


class MessageFeedback(Base):
    """一条消息最多一条反馈：差评是「未解决」的主视图，光靠 status 分不出答对答错。

    刻意不往 message 上加 `feedback_score` 之类的汇总列 —— 那正是
    `user.*_token_used` 的成因：有人读、没人写。这里只有这一张表是事实源。

    级联走**数据库**（`ondelete="CASCADE"`）：`message_conversation_id_fkey` 实测是
    NO ACTION，删会话是靠 ORM 关系上的 cascade 完成的，而这张表没有 ORM 关系，
    所以必须由 FK 自己带走，否则删一条带反馈的消息会被外键当场挡死。
    """

    __tablename__ = "message_feedback"

    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("message.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id = Column(
        Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 'up' | 'down'。没有中间值：反馈的价值在于能筛，不在于打分刻度。
    verdict = Column(String, nullable=False)
    # 「错在哪」比「错了」值钱，所以留正文；但可以空。
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MemoryItem(Base):
    __tablename__ = "memory_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    scope = Column(String, index=True, default="personal")
    content = Column(Text)
    sensitivity = Column(String, index=True, default="normal")
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    meta = Column(JSONB, nullable=True)

    user = relationship("User", back_populates="memory_items")
    user_id = Column(Integer, ForeignKey("user.id"), nullable=True, index=True)
    source_message_id = Column(
        UUID(as_uuid=True), ForeignKey("message.id"), nullable=True
    )


class ToolCall(Base):
    __tablename__ = "tool_call"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tool_name = Column(String, index=True)
    input = Column(JSONB, nullable=True)
    output_summary = Column(Text, nullable=True)
    status = Column(String, index=True, default="pending")
    risk_level = Column(String, index=True, default="low")
    requires_confirmation = Column(Boolean, default=False)
    confirmed_by = Column(Integer, ForeignKey("user.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    meta = Column(JSONB, nullable=True)

    conversation_id = Column(
        UUID(as_uuid=True), ForeignKey("conversation.id"), index=True
    )
    message_id = Column(UUID(as_uuid=True), ForeignKey("message.id"), nullable=True)
    conversation = relationship("Conversation", back_populates="tool_calls")


class AudioAsset(Base):
    __tablename__ = "audio_asset"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    purpose = Column(String, index=True)
    path = Column(String)
    sha256 = Column(String, index=True)
    duration_ms = Column(Integer, nullable=True)
    transcript = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    meta = Column(JSONB, nullable=True)

    user = relationship("User", back_populates="audio_assets")
    user_id = Column(Integer, ForeignKey("user.id"), nullable=True, index=True)
    message_id = Column(UUID(as_uuid=True), ForeignKey("message.id"), nullable=True)


class UserDatabasePermission(Base):
    __tablename__ = "user_database_permission"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    database_id = Column(
        Integer, ForeignKey("database.id", ondelete="CASCADE"), nullable=False
    )
    can_read = Column(Boolean, default=True)
    can_write = Column(Boolean, default=False)
    can_manage = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="database_permissions")
    database = relationship("Database", backref="user_permissions")


class TenantMember(Base):
    __tablename__ = "tenant_member"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(
        Integer, ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, default="member")  # owner, admin, member
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", backref="members")
    user = relationship("User", backref="tenant_memberships")

    __table_args__ = (UniqueConstraint("tenant_id", "user_id"),)


class InferenceRoleBinding(Base):
    """本系统用哪个模型充当 llm / embedding / rerank。

    这是**唯一**一张属于 Ametrine 的推理配置表。刻意只存指向关系：
    模型清单、运行状态、显存、launch 参数、维度全部由 xinference 的 API 现算
    （`/v1/models`、`/status`、`/v1/autostart/models`、`/v1/models/{type}/{name}/versions`），
    抄一份进库就是第二个事实源 —— `user.*_token_used` 那三个「有人读、没人写」的死列
    就是这么来的。

    主键就是 role：一个角色只能有一个当前模型，这条约束由数据库保证，
    而不是靠代码记得先去重。
    """

    __tablename__ = "inference_role_binding"

    role = Column(String(16), primary_key=True)
    model_uid = Column(String(128), nullable=False)
    # 只为界面显示与审计；真相仍以 model_uid 在服务端查到的为准。
    model_name = Column(String(128), nullable=False, default="")
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by = Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
