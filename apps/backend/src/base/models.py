from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


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

    id = Column(String, primary_key=True, index=True)
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

    doc_id = Column(String, ForeignKey("document.id"), index=True)
    document = relationship("Document", back_populates="chunks")