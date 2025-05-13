from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

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
    database = Column(String, unique=True, index=True)
