from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
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
    name = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password = Column(String)

    role = relationship("Role", back_populates="members")
    role_id = Column(Integer, ForeignKey("role.id"))


class Tenant(Base):
    __tablename__ = "tenant"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    database_id = Column(Integer, ForeignKey("database.id"), unique=True)
    database = relationship("Database", back_populates="tenant", cascade="all, delete")


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

    doc_id = Column(UUID(as_uuid=True), ForeignKey("document.id"))
    document = relationship("Document", back_populates="chunks")


class Conversation(Base):
    __tablename__ = "conversation"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    title = Column(String, index=True)
    mode = Column(String, index=True, default="llm")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    archived_at = Column(DateTime(timezone=True), nullable=True)
    meta = Column(JSONB, nullable=True)

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


class MemoryItem(Base):
    __tablename__ = "memory_item"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    scope = Column(String, index=True, default="personal")
    content = Column(Text)
    sensitivity = Column(String, index=True, default="normal")
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    meta = Column(JSONB, nullable=True)

    user_id = Column(Integer, ForeignKey("user.id"), nullable=True, index=True)
    source_message_id = Column(UUID(as_uuid=True), ForeignKey("message.id"), nullable=True)


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

    user_id = Column(Integer, ForeignKey("user.id"), nullable=True, index=True)
    message_id = Column(UUID(as_uuid=True), ForeignKey("message.id"), nullable=True)
